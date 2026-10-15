# Security notes

## Implemented controls

- Registrasi terbuka tanpa kode undangan; tidak ada login bypass atau default admin. Password >=12, <=128 karakter, salted scrypt. Session cookie random 256-bit; database hanya menyimpan SHA-256 token; expiry tujuh hari.
- Cookie HttpOnly, SameSite=Lax, Secure default. `COOKIE_SECURE=false` hanya untuk HTTP lokal. Mutasi memerlukan exact `APP_ORIGIN` dan HMAC CSRF yang terikat session cookie. Login/register juga membutuhkan exact Origin + JSON.
- Per-endpoint authentication dan owner scoping untuk metadata, thumbnails, media files, jobs, activities, preferences, challenges dan SSE. Password change memvalidasi current password dan menghapus sesi login lain.
- JSON maksimal 16 KiB tanpa mengandalkan Content-Length; strict Zod schemas; UUID/pagination bounds. Tidak ada upload atau endpoint URL-fetch bebas.
- Rate limit PostgreSQL atomic: global auth 120/menit, akun login 10/5 menit, API 600/menit/pengguna, connect 5/5 menit, download 30/menit, file 120/menit, SSE opens 20/menit. Global auth cap sengaja tidak mempercayai X-Forwarded-For yang bisa dipalsukan.
- AES-256-GCM dengan nonce acak dan AAD user/scope/key. Master key 32 bytes hex, tidak memiliki fallback. Secrets/descriptor/challenge tidak keluar melalui API selain QR/kode sementara untuk owner yang memang menautkan.
- Signal keys dan credentials disimpan bersama secara durable; stale generation tidak dapat menulis setelah revoke. Flush pending auth writes saat penutupan socket.
- Provider logger silent **dan** raw console difilter di worker bootstrap: source libsignal mempunyai console dump session records. Hanya event operasional allowlist yang dicetak; extra fields selalu dihapus. Jangan mengganti bootstrap dengan menjalankan main.ts langsung.
- API errors hanya code/pesan aman; tidak mengirim stack, query, token, URL CDN atau provider error mentah. Activity DB berisi kind/timestamp saja.
- CDN media: HTTPS, hostname WhatsApp allowlist, tanpa userinfo/custom port; DNS lookup menolak non-public IP; setiap redirect divalidasi dispatcher; timeout agent dihancurkan. Media URLs bukan input browser. Worker URL internal adalah konfigurasi operator yang dipercaya, bukan parameter request.
- Magic MIME whitelist JPEG/PNG/WebP/MP4, batas stream 64 MiB, kuota 512 MiB, integrity hash bila diberikan provider, ffprobe deadline. Tidak menjalankan shell berdasarkan nama file atau konten.
- Filename server-generated; storage key berbasis UUID, extension whitelist, tanpa path dari client. Private directories 0700, files 0600; symlink file ditolak. Browser mendapat Content-Type nyata, nosniff, private/no-store, Content-Disposition aman.
- Temporary/orphan cleanup, retention, explicit confirmed deletion. Session disconnect menghapus credentials/descriptor dari active DB dan memblokir stale writes.
- Security headers: CSP (self resources, no object, restricted base/form), no-referrer, nosniff, Permissions-Policy, HSTS production. Frame ancestors self default; Arena embed opt-in hanya untuk preview.

## Operator responsibilities / residual risk

1. **Integrasi tidak resmi** tetap berisiko. Izin pengguna tidak membuat Baileys menjadi resmi atau membatalkan ketentuan WhatsApp. Jangan gunakan untuk stalkerware, spam, atau akun yang tidak diizinkan.
2. Provider bisa melihat payload akun di prosesnya. App meminimalkan penyimpanan, tetapi bukan sandbox untuk menyembunyikan akun dari library integrasi.
3. Master encryption key terpisah dari DB, wajib backup aman. Kehilangan key memerlukan relinking; jangan melakukan rotasi in-place tanpa rencana migrasi ciphertext. Rotasi master key juga mengubah CSRF derivation.
4. Penghapusan menghapus active records/files, **bukan jaminan forensic wipe** dari SSD, WAL, snapshot atau backup. Tetapkan TTL backup, akses operator, encryption-at-rest volume dan kebijakan restore yang sesuai. Salinan file yang sudah diunduh pengguna tidak dapat ditarik kembali.
5. Remote logout best-effort. Owner harus memastikan perangkat sudah dikeluarkan di WhatsApp → Perangkat tertaut, terutama saat jaringan/worker tidak tersedia.
6. Worker HTTP harus lewat Railway private networking; jangan buat public domain. Service secret harus random >=32 karakter. Web dan worker memakai env credentials terpisah dari repo. Gunakan role DB least-privilege untuk lingkungan Anda; konfigurasi default belum memisahkan role SQL web/worker.
7. CSP mengizinkan inline script/style untuk bootstrap Next dan JSX styles; tidak ada raw HTML rendering. Ini bukan nonce-only CSP. Jangan menambahkan `dangerouslySetInnerHTML` atau third-party analytics tanpa review.
8. Tidak ada MFA, email verification, self-service password reset, antivirus, WAF, maupun audit keamanan independen. Pendaftaran terbuka berarti siapa pun yang mempunyai akses website dapat membuat akun. Isolasi data tetap berlaku, tetapi perlu memantau pemakaian resource dan abuse; ini bukan klaim sertifikasi enterprise.
9. TLS termination, reverse-proxy request/connection limits, infrastructure patching, backup restore, storage capacity monitoring, encryption-at-rest media volume dan alerting adalah tanggung jawab deployment.
10. Pin dependencies/lockfile; audit sebelum deploy. Override `deepmerge-ts: 8.0.0` menutup advisory stack exhaustion dari transitive Prisma config; CLI generate/migrate/build diuji dengan override ini.

## Pelaporan

Laporkan secara privat kepada pengelola instalasi. Jangan sertakan `.env`, database dump, QR, kode penautan, Signal keys atau media pribadi dalam issue publik. Untuk diagnosis, kirim code error, timestamp dan langkah reproduksi yang sudah disanitasi.
