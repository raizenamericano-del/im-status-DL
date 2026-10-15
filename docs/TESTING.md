# Hasil pengujian

Validasi terakhir: **15 Oktober 2026**. Install bersih `npm ci`, lalu `npm run verify` dijalankan dengan **Node 22.23.3**, PostgreSQL **17**, Chromium Playwright **1.64.1**, FFmpeg/ffprobe, Linux. Pengembangan/pengujian awal juga berjalan di Node 20.20.2. Node 22 direkomendasikan untuk deployment baru.

Rilis v1.1.0 menambahkan pengujian registrasi tanpa undangan, classifier error backend, serta schema database yang sengaja dihilangkan dan dipulihkan di DB pengujian.

## Hasil yang benar-benar dieksekusi

| Pemeriksaan                                            | Hasil                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Clean `npm ci`                                         | Lulus; lockfile terpakai                                                            |
| Prettier check                                         | Lulus                                                                               |
| ESLint (termasuk React rules-of-hooks/exhaustive-deps) | Lulus                                                                               |
| TypeScript strict `tsc --noEmit`                       | Lulus                                                                               |
| Unit tests                                             | **83 lulus**, 5 test files                                                          |
| Migrasi PostgreSQL test                                | Lulus memakai migration file; rerun idempotent                                      |
| Integration                                            | **20 skenario lulus** pada database nyata terpisah                                  |
| Next production build/start                            | Lulus                                                                               |
| Browser                                                | **15 skenario lulus**                                                               |
| Axe WCAG 2A/2AA/2.1AA                                  | **16 audit halaman, 0 violations** yang terdeteksi                                  |
| Responsive                                             | Lebar **360, 390, 1440 px**; tidak ada horizontal overflow pada rute yang diperiksa |
| JavaScript page errors                                 | 0 dalam suite browser                                                               |
| npm audit                                              | **0 vulnerabilities** saat pemeriksaan                                              |

Bukti mesin: [integration-result.json](integration-result.json), [browser-result.json](browser-result.json), [verification.json](verification.json), [verification-log.txt](verification-log.txt). Screenshot ada di `screenshots/`; gambar video diberi nama **video-test-fixture.png** karena sumbernya mock, bukan Status akun nyata.

## Cakupan unit

AES-GCM nonce/AAD/tamper; missing key; scrypt/cookie/CSRF/origin; strict JSON/body bounds; pagination/UUID; host/protocol/port/userinfo SSRF checks; private/link-local/IPv6-mapped IP; safe storage paths; MIME magic; Range; filter private/group/view-once/text/expired Status; thumbnail bounds; exact bytes/SHA-256; atomic file persistence; 64 MiB stream bound; stalled-stream timeout; real ffprobe duration; unwritable filesystem; temp/orphan cleanup; libsignal raw log suppression.

## Cakupan integrasi (DB nyata, provider mock)

Tambahan v1.1.0: pendaftaran tanpa variabel/payload undangan (termasuk variable lama yang diabaikan); health/pendaftaran mengembalikan DATABASE_NOT_READY ketika tabel rate-limit diubah namanya sementara di database test, lalu pulih setelah schema dikembalikan.

1. Health public, private endpoints menolak anonymous.
2. CSRF/origin/consent.
3. QR challenge bukan Connected; hanya hook open mengubah state.
4. **Encrypted auth + Signal keys ditulis di child process A, dibaca ulang di child process B**, digest sama. Tidak memakai sesi WhatsApp nyata.
5. Dedupe ingest, ciphertext, isolasi owner.
6. Concurrent download requests tidak menggandakan job; Completed hanya setelah bytes/file ada.
7. File service produksi yang sama: exact bytes, 206/416, filename aman, service auth dan owner isolation.
8. Search/filter/count metadata.
9. SSE hanya data owner, tanpa challenge/secrets.
10. Delete ditandai, akses ditolak, file benar-benar hilang setelah cleanup.
11. Provider failure/timeout durable; retry dan attempts.
12. Retensi serta expired descriptors; isolasi preferences.
13. Disconnect generation-fences stale credentials/events.
14. Worker offline/provider disabled.
15. Atomic persistent rate limits dengan concurrent requests.
16. UUID/URL injection rejection.
17. Password change/session revocation/logout.
18. Safe errors tanpa stack/credential exposure.

## Cakupan browser

Landing/auth; secure cookie; honest empty states; desktop/mobile navigation; filters/search; preference persistence; password confirmation; consent gate; pairing waiting state; **explicit test-only provider confirmation**; SSE; photo prepare/save/download; toast tetap terlihat dalam native dialog; JPEG decode; MP4 play/pause/mute/seek; grid/list/sort/delete confirmation; job history/activity; mobile menu/help/escape; disconnect; logout.

Mock worker berada di `tests/browser-worker.ts`. Ia menolak database yang tidak berakhiran `_test`. Entry produksi hanya menggunakan Baileys; tidak ada switch mock di frontend atau seed palsu pada database produksi.

## Temuan yang diperbaiki

- Pada rerun v1.1, kontrol preferensi yang bisa diedit sebelum data awal dimuat ditemukan dapat menimpa pilihan pengguna. Kontrol kini dinonaktifkan hingga data awal diterapkan, dan seluruh suite lulus setelah perbaikan.

- Ukuran teks mobile dan kontras muted text diperbaiki; dua temuan kontras terakhir pada panel privasi landing diperbaiki dan semua audit dijalankan ulang.
- Raw console libsignal berpotensi mencetak session keys; production bootstrap sekarang hanya mengizinkan event log tersanitasi.
- Toast global awalnya berpotensi tertutup native dialog top-layer; portal mengikuti dialog aktif, diuji dalam unduhan media.
- Direct storage preparation error diklasifikasikan sebagai STORAGE_ERROR; stale data UI dibersihkan saat request gagal.
- Dependency advisory transitive deepmerge-ts ditangani dengan override 8.0.0; seluruh generate/migrate/build/test diulang setelah override.

## Belum terverifikasi / bukan klaim

- QR/code diterima oleh **WhatsApp nyata**, incoming Status nyata, CDN media nyata, remote logout, reconnect akun nyata setelah restart.
- Penerimaan seluruh Status kontak (memang tidak didukung/dijanjikan).
- Docker/Compose build/run: Docker daemon tidak tersedia di lingkungan ini.
- Push GitHub, GitHub Actions pada runner GitHub, deployment Railway, mount persistence/restore pada Railway.
- Perangkat Android fisik, Safari/iOS, semua browser/codecs, load test multi-user besar, pentest independen.
- “0 axe violations” bukan sertifikasi aksesibilitas menyeluruh; pemeriksaan manual/device dan assistive technology tetap diperlukan.
- “0 npm audit” bersifat waktu-pemeriksaan, bukan jaminan tidak adanya kelemahan.

## Reproduksi

Lihat README. Jalankan suite lengkap dengan database disposable `_test`, FFmpeg, dan Chromium terpasang. Ports 3300/3213/3212 harus kosong. Suite menghapus seluruh user/data pada database test; tidak gunakan nama produksi yang kebetulan diakhiri `_test`.

Log pengujian berisi metadata fixture dan hasil, tidak berisi master key, QR autentik atau token session.

## Preview Arena

Web dan worker health lokal mengembalikan HTTP 200. Live Preview dibuka melalui panel Arena. URL mentah E2B memakai traffic access token platform; permintaan langsung tanpa token mendapatkan 403 dari infrastruktur, bukan dari aplikasi. Jangan mempublikasikan token platform atau menjadikan URL mentah sebagai tautan deployment publik.
