# IM Status Hub — v1.1.0

**Momen singkat. Tersimpan rapi.** Workspace pribadi untuk menerima Status WhatsApp yang tersedia, menyiapkan pratinjau, menyimpan foto/video dengan izin, dan mengelola library persisten.

> **Bukan API resmi WhatsApp/Meta.** Integrasi memakai Baileys `7.0.0-rc14` (release candidate, MIT). Tidak dapat mengambil semua Status teman atau melewati privasi. Gunakan hanya akun milik sendiri/yang memberi izin eksplisit. Pemilik menyelesaikan QR/kode di WhatsApp sendiri. Risiko perubahan protokol, disconnect, dan pembatasan akun tetap ada.

![Workspace desktop dalam kondisi kosong yang sebenarnya](docs/screenshots/dashboard-desktop.png)

**Update dari v1.0:** lihat [panduan pembaruan](docs/UPDATE-1.1.md). Pendaftaran kini terbuka; siapa pun yang dapat membuka website dapat membuat akun sendiri, tetapi tidak dapat mengakses data akun lain.

## Apa yang ada

- Landing, login/pendaftaran tanpa kode undangan, dashboard, koneksi, Status Center, Media Library, riwayat, aktivitas, pengaturan.
- Next.js App Router, React, TypeScript strict, Tailwind + CSS responsif, Lucide, font lokal Manrope. Navigasi Android, dialog fokus-terkunci, reduced motion, notifikasi SSE dengan polling cadangan.
- PostgreSQL/Prisma untuk seluruh metadata, session login, antrean, kredensial terenkripsi, preferensi dan aktivitas.
- Worker Node terpisah: QR/kode penautan, reconnect terbatas, penerimaan event `status@broadcast`, unduhan streaming, cleanup, dan streaming file ber-HTTP Range.
- AES-256-GCM untuk credentials/Signal keys, challenge, payload penautan, dan descriptor media. Tidak memakai `useMultiFileAuthState` plaintext.
- Password scrypt; cookie HttpOnly/Secure/SameSite; CSRF + exact-origin checks; ownership di tiap resource; validasi Zod; rate limit PostgreSQL.
- Media maksimum **64 MiB/file**, kuota **512 MiB/pengguna**, retensi **1–90 hari** (default 7). Unduhan asli yang diberikan provider, tanpa transcode/upscale.

## Mulai lokal

**Disarankan Node 22 LTS**, npm, PostgreSQL 17 dan FFmpeg (`ffprobe` harus tersedia). Node minimum 20.19; Node 20 sudah bukan pilihan deployment baru yang disarankan.

```bash
npm ci
npm run setup
```

`setup` membuat `.env` dengan secret acak dan tidak mencetaknya. Ia **tidak menimpa** file yang sudah ada. Edit `.env`:

1. Isi `DATABASE_URL` untuk database PostgreSQL kosong milik Anda.
2. `APP_ORIGIN=http://localhost:3000` (origin browser persis, tanpa `/` di akhir).
3. Untuk HTTP lokal, `COOKIE_SECURE=false`; untuk HTTPS publik, **true**.
4. Pertahankan `ENCRYPTION_KEY` dan `WORKER_SECRET` yang dibuat. Web/worker wajib memakai key yang sama.

```bash
npm run db:generate
npm run db:migrate
npm run dev
# Terminal kedua:
npm run worker
```

Buka `http://localhost:3000`. Buat akun cukup dengan **nama, email, dan kata sandi**. Tidak perlu kode undangan. Akun lama tetap bisa digunakan. Tidak ada akun admin, password default, atau kontak contoh yang otomatis dibuat.

Untuk mode production lokal:

```bash
npm run build
npm start
# Jalankan worker secara terpisah seperti di atas.
```

`npm start` membaca `.env`, menerima `PORT`, bind `0.0.0.0`, dan memilih worker jika `SERVICE_ROLE=worker`.

### Opsi Docker Compose

```bash
npm run setup
# Pastikan POSTGRES_PASSWORD di .env terisi (setup menghasilkan nilai acak).
docker compose up --build
```

Compose menyediakan PostgreSQL, web, worker, volume database dan volume media. Compose ini **khusus HTTP lokal**: jangan gunakan override cookie/origin lokalnya untuk deployment publik. Docker/Compose disediakan sebagai konfigurasi; lihat dokumen pengujian untuk yang benar-benar dieksekusi.

## Menghubungkan WhatsApp

1. Login → **Koneksi WhatsApp**. Pastikan worker dan storage siap.
2. Pilih QR atau kode penautan. Untuk kode, masukkan nomor Anda dalam format kode negara + angka tanpa `+`.
3. Baca risiko dan centang pernyataan kepemilikan/izin.
4. Pemilik membuka WhatsApp → **Perangkat tertaut → Tautkan perangkat**. Pindai QR atau pilih tautkan dengan nomor telepon dan masukkan kode sendiri.
5. Menampilkan QR/kode **belum berarti Connected**. UI baru menyatakan Terhubung setelah event `connection.update: open`.
6. Tunggu Status foto/video baru yang memang dikirim ke sesi ini. Refresh hanya memuat ulang database, bukan mengambil semua Status WhatsApp.

**Pratinjau penuh juga menyimpan media ke library.** Pengguna diberi penjelasan sebelum menyiapkan file. “Unduhan selesai” berarti bytes sudah berhasil disimpan oleh server; sistem tidak bisa menjamin browser menyimpan file ke folder Downloads perangkat.

## Deployment GitHub / Railway

Arsitektur produksi: **1 web + 1 worker + PostgreSQL + volume persisten khusus worker**. Web tidak membutuhkan volume dan mengambil file dari HTTP internal worker dengan service secret. Tidak mencoba membagi satu volume Railway ke dua layanan.

Ikuti **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** untuk environment, migrasi, konfigurasi kedua layanan, volume, backup, dan langkah deploy. Tidak ada push GitHub atau deployment Railway otomatis di dalam proyek ini.

## Pengujian

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Suite lengkap memerlukan database **khusus pengujian** berakhiran `_test` dan menghapus data di database tersebut:

```bash
# Buat database imhub_test dengan user yang sama / user pengujian terpisah.
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/imhub_test'
npx playwright install --with-deps chromium
npm run verify
```

`verify` menjalankan unit, migrasi test, integration, build, app + mock worker sementara, Chromium, axe, dan audit npm; server test ditutup setelah selesai. Port 3300/3213/3212 harus kosong. Tidak menghubungkan akun WhatsApp nyata.

- [Hasil dan batas verifikasi](docs/TESTING.md)
- [Evaluasi provider dan sumber](docs/PROVIDER.md)
- [Arsitektur / lifecycle](docs/ARCHITECTURE.md)
- [Keamanan / operasi](docs/SECURITY.md)
- [API](docs/API.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Checklist penerimaan](docs/ACCEPTANCE.md)

## Yang sengaja tidak diklaim

- Seluruh Status teman, backfill Status lama, bypass privasi, status sekali lihat, chat downloader, bot pengirim pesan, atau endpoint untuk mengambil URL bebas.
- Integrasi resmi Meta, bebas risiko ban, atau kompatibilitas WhatsApp yang permanen.
- Keberhasilan pairing/reconnect akun WhatsApp nyata dalam pengujian ini. Penyimpanan auth teruji lintas proses; koneksi eksternal tetap perlu uji berizin oleh pemilik akun.
- Cloud/object storage otomatis: persistence media memerlukan **volume worker** yang benar-benar dipasang. Disk lokal development saja tidak cukup untuk Railway.

Lisensi kode proyek: MIT. Lisensi font dan dependency tetap berlaku. Lihat [THIRD_PARTY.md](docs/THIRD_PARTY.md).
