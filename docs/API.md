# HTTP API

Base `/api`. Sukses JSON `{ "data": ... }`; gagal `{ "error": { "code": "...", "message": "..." } }`. File dan SSE bukan JSON. Semua resource pengguna membutuhkan `im_session`; semua mutasi membutuhkan exact `Origin` + `X-CSRF-Token` dari `/auth/me`. JSON body maksimal 16 KiB. Tidak ada endpoint URL downloader bebas.

| Method | Path                      | Keterangan                                                                                            |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/health`                 | Public; cek database dan schema rate-limit, tanpa secret/detail internal                              |
| POST   | `/auth/register`          | Public + exact origin + rate limit; `{name,email,password}`; tanpa kode undangan                      |
| POST   | `/auth/login`             | Public + exact origin + rate limit; `{email,password}`; set cookie                                    |
| GET    | `/auth/me`                | Identitas workspace + CSRF token session                                                              |
| POST   | `/auth/logout`            | Revoke login session, hapus cookie; tidak mencabut sesi WhatsApp                                      |
| POST   | `/auth/password`          | `{current,password}`; revoke login sessions lain                                                      |
| GET    | `/dashboard`              | Counts nyata, backend condition, recent media/activity                                                |
| GET    | `/wa/session`             | State, last connection, safe error, owner-only challenge sementara                                    |
| POST   | `/wa/connect`             | `{consent:true,method:"qr"}` atau `method:"code",phone:"628..."`; 202 berarti queued, bukan Connected |
| POST   | `/wa/disconnect`          | Revoke local credentials/descriptor; remote logout best-effort                                        |
| GET    | `/statuses`               | `page`, `q` nama kontak, `filter=all                                                                  | photo | video                | saved   | unsaved`; aktif + descriptor tersedia saja |
| GET    | `/statuses/:id`           | Metadata status milik owner + media/job terkait                                                       |
| GET    | `/statuses/:id/thumbnail` | JPEG provider, jika tersedia; auth; no-store                                                          |
| POST   | `/statuses/:id/download`  | Queue/retry idempotent; return jobId/state atau existing mediaId                                      |
| GET    | `/library`                | `page`, `q` nama file, `filter=all                                                                    | photo | video`, `sort=newest | oldest` |
| GET    | `/media/:id`              | Metadata file tersimpan milik owner                                                                   |
| GET    | `/media/:id/file`         | Bytes original; `?download=1` attachment, tanpa query inline; single Range 206/416                    |
| DELETE | `/media/:id`              | 202 DELETING; langsung inaccessible, file dihapus worker                                              |
| GET    | `/history`                | Pagination job states + attempts/errors; hingga 90 hari                                               |
| GET    | `/activity`               | Pagination kind/timestamp; tanpa isi pesan/codes/tokens                                               |
| GET    | `/preferences`            | retentionDays dan notifications                                                                       |
| PATCH  | `/preferences`            | `{retentionDays:1..90,notifications:boolean}`                                                         |
| GET    | `/events`                 | Authenticated SSE `event: update`, latest activity id/kind/timestamp; no challenge/credentials        |

Pagination: `page` integer 1–10000; 24 item; response `{items,total,page,pages}`. Search maksimal 100 karakter. Unknown filters tidak menambah akses; frontend memakai filter yang tercantum.

## Error categories

- 400 invalid schema/consent/pagination; 401 login/session; 403 CSRF/origin.
- 404 resource tidak ada **atau bukan milik owner**.
- 409 session offline / deletion pending; 410 status/media expired; 413 request/media/quota limit; 415 unsupported media/JSON type.
- 416 invalid/unsatisfiable Range; 429 rate limit + Retry-After.
- 503 worker/provider disabled/storage/backend unavailable; job error DOWNLOAD_TIMEOUT menunjukkan pengambilan melewati deadline.
- Error mentah/stack dari DB/provider tidak disertakan. Error code jobs dipetakan ke pesan yang aman.

## Worker internal (bukan browser API)

`GET /health` mengecek readiness/database. `GET /media/:uuid` memerlukan `Authorization: Bearer WORKER_SECRET` dan `X-User-Id` dari web yang sudah mengautentikasi owner. Mendukung satu Range; owner diverifikasi kembali di database. Tidak ada parameter filename/path/remote URL.

Client tidak pernah mendapatkan WORKER_SECRET atau direct worker URL. Gunakan private network untuk endpoint ini.

Sejak v1.1.0: `DATABASE_NOT_READY` (503) untuk tabel/kolom belum tersedia, `DATABASE_UNAVAILABLE` (503) untuk koneksi database, dan `SERVER_CONFIG_INCOMPLETE` (503) untuk konfigurasi key yang belum valid. Tidak ada detail query/credential dalam pesan.
