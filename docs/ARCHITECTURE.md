# Arsitektur

```text
Browser (HTTPS, cookie, CSRF)
  ├── Next.js UI / authenticated API
  │     ├── PostgreSQL: user, auth/session, metadata, jobs, activity, preferences
  │     ├── SSE owner-scoped updates (poll DB 2.5s; client fallback 15s)
  │     └── HTTP internal worker + service secret + trusted owner ID
  └── Tidak pernah menerima auth credentials / Signal keys / descriptor URL

Worker (satu replica, long-running)
  ├── PostgreSQL advisory lock: hanya satu worker per database
  ├── Command queue → provider session manager → Baileys WebSocket
  ├── Encrypted database auth store + generation fencing
  ├── Download jobs → guarded CDN streaming → private volume
  ├── Authenticated file endpoint, Range, verified owner
  └── Heartbeat, retention, cleanup, orphan recovery
```

## Lapisan

- `app/`, `components/`: UI, state loading/error/empty, API client. Semua resource bersifat private; anonymous users diarahkan login, endpoint menolak data tanpa cookie.
- `app/api/[...path]/route.ts`: route boundary, auth, Zod validation, HTTP status; tidak menulis file provider secara langsung.
- `lib/services`: use-cases dashboard/session/queue; `lib/auth` login; `lib/security` encryption/CSRF/rate/SSRF; `lib/db` Prisma; `lib/storage` file I/O terbatas.
- `worker/providers`: interface Provider dan adapter Baileys. Mock hanya berada di `tests/` dan tidak diimpor aplikasi/worker produksi.
- `worker/auth-store.ts`: BufferJSON + AES-GCM auth store, key writes transaksional, flush saat menutup socket.
- `worker/sessions.ts`: hook provider → metadata. `worker/ingest.ts`: Status upsert terisolasi.
- `worker/jobs.ts`: lifecycle unduhan/cleanup. `worker/http.ts`: file service yang sama dipakai aplikasi dan integration tests.
- `worker/bootstrap.ts`: mematikan raw console library sebelum memuat integrasi. Jalankan entrypoint ini, bukan `main.ts` langsung.

## Model database

`User`, `AuthSession`, `WaSession`, `Secret`, `Status`, `Media`, `DownloadJob`, `Activity`, `Preference`, `Command`, `WorkerHealth`, `RateBucket`.

Semua objek pengguna memiliki userId dan ownership checks. Composite `Secret(userId,key)` menyimpan ciphertext, tidak plaintext. Status dedupe `(userId,fingerprint)`, satu Media/Job per status. UUID tidak diperlakukan sebagai izin akses.

## Sesi

`DISCONNECTED → CONNECTING → AWAITING_PAIRING → CONNECTED`, atau ERROR. `desired` menyatakan keinginan owner, bukan bukti koneksi. QR/kode terenkripsi, hanya diekspos endpoint owner, TTL QR 55 detik / kode 120 detik. Adapter membatasi percobaan penautan 180 detik.

Setiap permintaan koneksi/disconnect menaikkan generation. Save credentials dan ingest mengunci WaSession row dan memeriksa generation/desired sebelum write. Disconnect menghapus Secret/challenge/descriptor dalam transaksi dan mengantrikan remote logout best-effort. Callback socket lama tidak dapat menghidupkan sesi lagi.

Heartbeat stale >20 detik membuat UI menampilkan WORKER_OFFLINE walaupun DB sebelumnya mencatat CONNECTED. Saat startup worker memuat sesi desired yang credentials-nya registered; sesi unregistered tanpa pending command tidak dilanjutkan diam-diam.

## Jobs / file consistency

`WAITING → PROCESSING → COMPLETED|FAILED`. Claim job menggunakan conditional update. Permintaan download/retry diserialkan dengan lock row Status, sehingga klik ganda tidak menggandakan file/job. Attempts disimpan; activity mencatat hasil, tanpa isi media.

- Stream dibatasi 64 MiB dan deadline 45 detik. Memori tidak memuat seluruh video.
- Temporary file private 0600 → cek magic MIME / hash → ffprobe video → atomic rename pada filesystem yang sama.
- Baru setelah file ada, transaksi membuat Media dan menandai COMPLETED. Jika transaksi gagal, file dibersihkan.
- Crash ekstrem di antara rename/commit menghasilkan orphan; cleanup menghapus orphan berumur >1 jam. File partial >1 jam juga dibersihkan.
- PROCESSING yang tertinggal saat restart menjadi FAILED/DOWNLOAD_INTERRUPTED, bukan sukses palsu. Pemilik bisa retry.
- Satu unduhan diproses pada satu waktu. Command loop dan heartbeat tetap berjalan saat download aktif.
- Penghapusan membuat `deleteRequestedAt`: akses segera ditolak, worker menghapus bytes, lalu metadata/activity. Penghapusan gagal dicoba lagi; tidak disebut selesai sebelum file dihapus.
- Retensi media per pengguna 1–90 hari; worker cleanup sekitar 30 detik. Descriptor/thumbnail dibuang setelah status kedaluwarsa; metadata Status dibuang tujuh hari setelah expiry, history/activity maksimal 90 hari. Media yang masih dipertahankan tetap ada setelah status metadata dibuang.

## Penyimpanan produksi

Railway volume hanya dipasang di **worker** pada `/data`; `MEDIA_ROOT=/data/media`. Web tidak membaca disk bersama; ia mem-proxy file setelah auth dan ownership checks. Worker memeriksa service token + user ID + pemilik file lagi.

Volume harus ikut backup/restore bersama PostgreSQL. Manifest metadata tanpa volume tidak memulihkan file. Keberadaan directory lokal bukan bukti storage Railway persistent—mount harus diuji di deployment sebenarnya.

## Skala / batas operasional

Satu worker per database (PostgreSQL advisory lock). Jangan autoscale worker. Web bisa ditambah setelah mengevaluasi pool DB/SSE, tetapi konfigurasi awal satu replica. SSE memakai polling DB, bukan Redis/pubsub; ini pilihan operasional untuk instalasi pribadi/kecil, bukan arsitektur throughput besar.
