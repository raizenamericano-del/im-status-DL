# Troubleshooting

| Gejala                                | Periksa / tindakan                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registrasi ditolak                    | Sejak v1.1.0 tidak perlu kode undangan. Pastikan source terbaru sudah di-deploy, APP_ORIGIN sesuai domain, database tersambung dan migrasi sudah dijalankan. Password minimal 12 karakter.                            |
| 403 setelah membuka domain baru       | APP_ORIGIN harus persis origin browser, termasuk scheme dan port, tanpa slash. Jika perlu izinkan beberapa origin dengan koma, bukan wildcard. Restart/redeploy setelah mengubah env.                                 |
| Login berhasil lalu kembali login     | Cookie Secure tidak dikirim melalui HTTP biasa. `false` hanya untuk lokal; gunakan HTTPS dan `true` di publik. Browser third-party cookie restrictions dapat membatasi preview iframe; buka domain aplikasi langsung. |
| Worker offline                        | Jalankan `npm run worker` atau service dengan SERVICE_ROLE=worker. DB/key harus cocok. Cek log event aman, `/health`, port dan advisory lock. Heartbeat >20 detik dianggap stale.                                     |
| Worker start failed                   | Validasi DATABASE_URL, migration, ENCRYPTION_KEY 64 hex, WORKER_SECRET >=32 karakter, direktori volume writable, native dependency/Node. Log sengaja tidak membocorkan exception/detail credentials.                  |
| worker_lock_busy                      | Ada worker lain memegang advisory lock. Hanya satu replica. Hentikan replica lama; jangan memaksa dua socket untuk auth store yang sama.                                                                              |
| Storage belum siap / STORAGE_ERROR    | Pastikan volume worker benar-benar mounted `/data`, MEDIA_ROOT=/data/media, izin directory 0700 milik user node, disk/kuota OS cukup. Web tidak harus mempunyai volume.                                               |
| QR/kode tidak muncul                  | Konfirmasi consent, worker aktif, ENABLE_WHATSAPP=true pada web dan worker, outbound network tersedia. Tunggu; jika 180 detik berakhir, mulai lagi. Jangan berasumsi kode ada sebelum provider memberikannya.         |
| Kode/QR kedaluwarsa                   | QR 55 detik, kode 120 detik di API; provider bisa mengganti QR. Batalkan lalu mulai ulang jika tidak ada challenge baru. Jangan screenshot/log challenge untuk debugging.                                             |
| Koneksi 428/protocol issue            | Cek release/changelog Baileys saat ini. Jangan mengarang token, memaksa auth, atau mencoba nomor tanpa izin. Versi dikunci; upgrade perlu review dan test ulang.                                                      |
| Connected tetapi Status kosong        | Menunggu **notify** Status baru yang dibagikan ke akun Anda. Kontak/privacy/provider menentukan ketersediaan. Refresh hanya membaca DB; history sync dan append batches tidak di-backfill.                            |
| Video/foto gagal diambil              | Media mungkin sudah tidak tersedia; buka safe error riwayat dan retry saat status masih aktif. Tidak ada automatic re-upload expired media. Gagal bukan Completed.                                                    |
| DOWNLOAD_TIMEOUT                      | Deadline 45 detik / network timeout; coba ulang. Pengambilan dibatasi 64 MiB. Jangan menaikkan batas tanpa menilai resource.                                                                                          |
| DOWNLOAD_INTERRUPTED                  | Worker berhenti di tengah proses. File tidak dilabeli selesai. Retry bila sumber masih tersedia.                                                                                                                      |
| UNSUPPORTED_MEDIA                     | Magic MIME bukan JPEG/PNG/WebP/MP4 atau ffprobe tidak dapat membaca video. Pastikan FFmpeg terpasang. Tidak ada konversi diam-diam.                                                                                   |
| SSRF_BLOCKED                          | Host/redirect/DNS bukan media WhatsApp publik yang diizinkan. Review upstream jika host berubah; jangan mematikan pemeriksaan atau menambah wildcard arbitrer.                                                        |
| Browser tidak menampilkan video       | Periksa worker/range request; coba unduh dan putar di perangkat. Codec yang diberikan provider mungkin tidak didukung browser. File tidak ditranscode otomatis.                                                       |
| File hilang setelah redeploy          | Kemungkinan worker memakai ephemeral disk atau volume salah. Restore metadata + bytes dari backup. Mengubah env path tidak membuat disk ephemeral menjadi persistent.                                                 |
| Retensi tidak langsung menghapus      | Worker cleanup sekitar 30 detik, sesuaikan jam server. Item dapat ditandai inaccessible sebelum penghapusan fisik selesai. Storage-error akan dicoba lagi.                                                            |
| Session expired / connection replaced | Owner harus relink; hapus perangkat lama di WhatsApp. Kredensial invalid tidak dipakai untuk bypass.                                                                                                                  |
| Disconnect saat worker offline        | Local credentials tetap dicabut di DB. Pastikan revoke perangkat dari WhatsApp karena remote logout tidak dapat dijamin.                                                                                              |
| `npm run verify` menolak DB           | TEST_DATABASE_URL wajib nama DB berakhiran `_test`; suite menghapus datanya. Buat database terpisah, jangan gunakan database produksi.                                                                                |
| Chromium/ffprobe hilang di CI         | `npx playwright install --with-deps chromium`; install ffmpeg OS. Worker produksi tidak memerlukan Chromium.                                                                                                          |

## Uji live yang harus dilakukan owner

1. Gunakan akun sendiri atau izin tertulis, baca risiko integrasi tidak resmi.
2. Tautkan QR; ulangi metode kode bila memang dibutuhkan. Catat hanya waktu/state, bukan QR/kode/OTP.
3. Minta kontak berizin membagikan satu foto dan video yang boleh disimpan; pastikan event baru tersedia ke akun ini.
4. Cek bytes/file asli, preview video, file download dan library; tidak mengklaim semua Status tampil.
5. Restart worker dengan DB/key/volume yang sama. Verifikasi apakah akun benar-benar reconnect tanpa penautan; jika tidak, tangani sebagai batas provider.
6. Disconnect dan pastikan perangkat dicabut dari aplikasi WhatsApp. Uji retensi dan restore hanya dengan media pengujian yang diizinkan.

## Error pendaftaran sejak v1.1.0

- `DATABASE_NOT_READY`: jalankan `npm run db:migrate` pada service web dengan DATABASE_URL yang benar. Health sekarang memeriksa schema juga.
- `DATABASE_UNAVAILABLE`: periksa reference DATABASE_URL dan layanan PostgreSQL. Jangan kirim connection string/password ke percakapan atau issue.
- `SERVER_CONFIG_INCOMPLETE`: pastikan ENCRYPTION_KEY berisi tepat 64 karakter hex. Jika key sudah digunakan, jangan menggantinya sembarangan.
- `FORBIDDEN`: tetap periksa APP_ORIGIN. Menghapus undangan tidak menonaktifkan perlindungan origin/CSRF.

Penyebab pasti error pada deployment pengguna tidak dapat dipastikan tanpa hasil request/log aman dari deployment tersebut.
