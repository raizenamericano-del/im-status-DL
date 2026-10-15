# Checklist penerimaan

## Terimplementasi dan diuji lokal

- [x] Proyek baru independen; landing, auth, semua halaman workspace; responsive mobile-first.
- [x] Authentication, registrasi tanpa undangan, password change/logout, CSRF, exact-origin, per-resource ownership.
- [x] PostgreSQL + migration, preferences/activity/history persisten.
- [x] Worker terpisah, encrypted credentials + Signal keys, command queue, generation fencing, heartbeat.
- [x] Provider adapter Baileys dengan QR dan pairing code sesuai API terpasang; UI Connected hanya dari event provider.
- [x] Filter event Status foto/video, tidak menyimpan private chat/view-once/riwayat lama.
- [x] Queue Waiting/Processing/Completed/Failed, dedupe, retry, safe errors.
- [x] Actual streaming bytes, ukuran/hash/format, ffprobe duration, batas ukuran/kuota/timeout.
- [x] Owner-only previews/downloads, video range/control, safe filename, library search/filter/sort/grid/list.
- [x] Confirmed delete, physical cleanup, retensi 1–90 hari, orphan recovery.
- [x] SSE owner-scoped notifications, safe logs, no fabricated contacts/counts/success.
- [x] Worker media file service: web tidak membutuhkan shared Railway volume.
- [x] Encrypted auth round-trip lintas dua proses diuji; bukan klaim live reconnect.
- [x] 83 unit tests, 20 integration scenarios, 15 browser scenarios, 16 axe audits; strict TS/lint/build/audit.
- [x] .env.example, Dockerfile, Compose, Railway web/worker configs, CI, docs keamanan/provider/deploy/troubleshooting.

## Wajib konfigurasi / uji owner sebelum produksi

- [ ] PostgreSQL produksi dan migration dijalankan di deployment.
- [ ] Secret random, domain/origin exact, HTTPS cookies, private worker networking.
- [ ] Railway volume worker benar-benar dipasang dan persistence/restore diuji.
- [ ] GitHub push / Actions / Railway deployment dilakukan owner (belum dilakukan di sini).
- [ ] Docker image benar-benar dibangun di platform deployment.
- [ ] Pairing QR/kode dan fresh Status/media dari akun berizin diuji nyata.
- [ ] Restart worker, live session resumption, remote revoke dan provider protocol compatibility diuji.
- [ ] Backup/WAL/snapshot retention, least-privilege DB roles, monitoring dan capacity ditetapkan.
- [ ] Android fisik dan browser target diuji.

## Tidak tersedia / sengaja tidak dibuat

- [ ] API resmi Meta untuk seluruh Stories teman — tidak ada fitur generik demikian.
- [ ] Mengambil Status private/semua history/once-view atau nomor tanpa izin.
- [ ] Universal URL downloader, hidden scraping, otomatis mengirim pesan atau upload Status.
- [ ] Jaminan bebas ban, selalu reconnect, format/kualitas tidak diberikan provider, atau browser pasti menyimpan file ke perangkat.
