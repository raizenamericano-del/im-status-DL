# Update v1.1.0 — daftar tanpa kode undangan

## Yang berubah

- Form Buat akun hanya meminta **nama, email, kata sandi**.
- Backend tidak lagi memeriksa kode undangan atau `REGISTRATION_INVITE`.
- Akun lama dan seluruh data tetap dipakai. Tidak ada reset database atau perubahan schema untuk rilis ini.
- Login, CSRF/origin checks, enkripsi dan isolasi pengguna tetap aktif.
- Error database/migrasi/key yang dikenali kini mendapat pesan spesifik yang aman. Health memeriksa schema rate-limit, bukan sekadar koneksi PostgreSQL.

**Konsekuensi:** siapa pun yang dapat membuka website dapat mendaftar akun sendiri. Mereka tidak otomatis bisa membaca sesi/media akun lain. Pantau pemakaian dan penyalahgunaan resource layanan.

## Pasang pada deployment yang sudah ada

1. Ekstrak source ZIP v1.1.0. Perbarui source di repository yang dipakai service web dan worker; jangan hanya menghapus variabel.
2. Pertahankan `DATABASE_URL`, `ENCRYPTION_KEY`, `WORKER_SECRET`, volume, dan data lama. **Jangan membuat key baru atau reset database.**
3. `REGISTRATION_INVITE` sekarang tidak dipakai. Boleh dihapus dari environment; bila tertinggal nilainya diabaikan.
4. Deploy ulang dari source terbaru. Konfigurasi web `railway.toml` tetap menjalankan `npm run db:migrate` sebelum start.
5. Setelah deploy berhasil, muat ulang halaman atau buka tab baru. Kolom kode undangan seharusnya tidak ada lagi.

Aplikasi yang sedang berjalan di server pengguna tidak berubah otomatis karena source di workspace ini diperbarui. Deployment eksternal perlu dilakukan pemilik.

## Kalau masih gagal daftar

Menghapus kode undangan **bukan jaminan memperbaiki gangguan backend** yang terjadi sebelumnya.

| Pesan baru                                | Tindakan pengelola                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Database belum siap                       | Jalankan migrasi `npm run db:migrate` pada database yang dipakai web. Tidak perlu db push/reset. |
| Database belum dapat diakses              | Pastikan PostgreSQL aktif dan `DATABASE_URL` service web merujuk database yang benar.            |
| Konfigurasi keamanan server belum lengkap | Periksa format `ENCRYPTION_KEY` (64 karakter hex), tanpa mengganti key lama yang valid.          |
| Permintaan tidak diizinkan                | `APP_ORIGIN` harus persis `https://domain-website`, tanpa path/slash akhir.                      |
| Pendaftaran tidak dapat diproses          | Email mungkin sudah terdaftar; coba tab Masuk.                                                   |

Tidak perlu mengirim password, database URL, key atau screenshot nilai secret. Cukup pesan/code error dan log event yang sudah disanitasi.
