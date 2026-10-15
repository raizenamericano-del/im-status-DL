# Deployment — GitHub / Railway

## Topologi wajib

- **PostgreSQL** persisten.
- **Web**: Next.js, public HTTPS, `SERVICE_ROLE=web`.
- **Worker**: satu replica long-running, `SERVICE_ROLE=worker`, private HTTP untuk file, **volume mounted `/data`**.

Tidak memakai serverless function untuk socket WhatsApp, tidak memakai filesystem ephemeral Railway untuk media, tidak membagi satu Railway volume ke dua service.

## 1. Siapkan repository

```bash
git init -b main
git add .
git commit -m "Initial IM Status Hub"
# Buat repository GitHub sendiri, kemudian:
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

Periksa `git status` terlebih dahulu. `.env`, runtime media, node_modules, build cache dan logs di-ignore. **Jangan commit key, database dump, session atau QR.** Tidak ada kredensial GitHub/Railway dalam aplikasi. Pembuatan repo/push/deploy eksternal harus dilakukan oleh pemilik.

## 2. Buat PostgreSQL Railway

Buat service PostgreSQL. Ambil connection string melalui reference variables Railway, bukan menaruh password dalam Dockerfile. Migrasi di `prisma/migrations/202610150001_init` sudah tersedia. `prisma migrate deploy` menggunakan migration file, bukan db push.

## 3. Web service

Deploy dari repo menggunakan `Dockerfile`, config `railway.toml`.

| Variable            | Nilai                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `SERVICE_ROLE`      | `web`                                                                                           |
| `DATABASE_URL`      | Reference connection string PostgreSQL                                                          |
| `APP_ORIGIN`        | `https://DOMAIN-WEB-ANDA` tanpa trailing slash; tambahkan custom domain dipisah koma bila perlu |
| `ENCRYPTION_KEY`    | Random 32-byte hex, sama dengan worker                                                          |
| `WORKER_SECRET`     | Random >=32 karakter, sama dengan worker                                                        |
| `COOKIE_SECURE`     | `true`                                                                                          |
| `ENABLE_WHATSAPP`   | `true` jika menerima risiko Baileys; `false` untuk menonaktifkan linking baru                   |
| `WORKER_URL`        | `http://NAMA-SERVICE-WORKER.railway.internal:3210`                                              |
| `ALLOW_ARENA_EMBED` | `false` (default); jangan aktifkan pada deployment umum                                         |
| `PORT`              | Port Railway untuk web, otomatis atau misalnya 3000                                             |

`WORKER_URL` adalah trusted operator config; jangan membuatnya menjadi input pengguna. Domain private contoh harus diganti dengan domain yang benar-benar ditampilkan Railway; bukan endpoint WhatsApp.

Pre-deploy: `npm run db:migrate`. Start: `npm start`. Health: `/api/health`. Web health mengecek DB; worker health ditampilkan terpisah di dashboard.

## 4. Worker service

Deploy repo yang sama. Di pengaturan service, pilih **config file path `railway.worker.toml`**. Tidak ada migration pre-deploy untuk worker; deploy setelah web menerapkan schema.

| Variable          | Nilai                                                         |
| ----------------- | ------------------------------------------------------------- |
| `SERVICE_ROLE`    | `worker`                                                      |
| `DATABASE_URL`    | Database yang sama dengan web                                 |
| `ENCRYPTION_KEY`  | Persis sama dengan web                                        |
| `WORKER_SECRET`   | Persis sama dengan web                                        |
| `ENABLE_WHATSAPP` | Sama dengan web                                               |
| `PORT`            | `3210`                                                        |
| `WORKER_PORT`     | `3210`, jika diisi harus konsisten dengan PORT dan WORKER_URL |
| `MEDIA_ROOT`      | `/data/media`                                                 |

Pasang **Railway Volume** di mount path `/data` pada worker. Jangan hanya menyetel MEDIA_ROOT tanpa mount. Entry Docker menyiapkan folder 0700, kemudian menjatuhkan privilege ke user `node` dengan gosu. PostgreSQL dan web tidak memakai volume media ini.

- **Jangan buat public domain worker.** Health `/health` hanya menunjukkan ready/DB; route media lainnya wajib service token.
- Satu replica, tanpa sleep/serverless. Advisory lock menolak worker kedua dengan DB sama. Horizontal scaling membutuhkan sharding/lease arsitektur baru.
- Izinkan outbound WhatsApp Web/CDN. Tidak ada inbound webhook Meta yang perlu didaftarkan.
- Build image melibatkan Prisma/native dependency dan FFmpeg. Mulai dengan resource build yang memadai (sekitar 2 GB RAM sebagai titik awal, ukur penggunaan aktual); bukan jaminan sizing setiap deployment.

## 5. Setelah deploy

1. Pastikan migration sukses, `/api/health` 200.
2. Worker `/health` 200 lewat jaringan internal; dashboard menampilkan worker aktif dan storage siap.
3. Buka domain web yang tepat; register dengan nama, email dan kata sandi (tanpa kode undangan). Tidak ada akun default.
4. Periksa cookie Secure/HttpOnly; origin check menolak domain lain. Set APP_ORIGIN lagi jika mengganti domain.
5. Pemilik menautkan akun sendiri; jangan meminta OTP, screenshot QR atau pairing code dikirim ke operator.
6. Terima satu Status baru yang diizinkan, simpan foto/video, periksa bytes, playback dan file hasil unduhan.
7. Restart **web**: akun/library tetap tersedia. Restart **worker**: periksa autentikasi WhatsApp kembali dan file masih ada. Ini **wajib diuji di Railway nyata**; hasil lokal bukan bukti keberlangsungan sesi provider.
8. Uji delete dan retention serta pencabutan perangkat dari ponsel.

## Backup / restore

Backup PostgreSQL + volume media + encryption key (key disimpan terpisah dengan akses terbatas). Jangan export sessions melalui dashboard. Restore ketiganya secara konsisten; metadata DB tanpa bytes tidak memulihkan file. Key hilang membuat ciphertext tidak dapat dibaca dan akun perlu di-link ulang.

Backup lama bisa masih memiliki credentials/media yang sudah dihapus. Tetapkan batas retensi snapshot dan prosedur agar restore tidak mengaktifkan ulang sesi yang sudah dicabut. Penghapusan aplikasi bukan jaminan overwrite sektor storage.

## Update

1. Review changelog Baileys dan lockfile; rc/protocol bisa berubah.
2. Jalankan `npm ci`, `npm run verify` di database terpisah, cek audit dan sumber upstream.
3. Backup, apply migration pada web, deploy web + worker dengan versi yang sama.
4. Uji akun berizin dan restart setelah update. Rollback DB hanya dengan rencana migration/backup yang jelas.

## Status konfigurasi ini

Konfigurasi repo, Dockerfile, compose, Railway files dan CI disediakan. **Docker daemon/GitHub Actions/Railway deployment belum dieksekusi pada lingkungan pengembangan ini.** Perintah Node build/start, DB/migration dan worker lokal benar-benar dieksekusi; lihat TESTING.md.
