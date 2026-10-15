import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error(
    'Set TEST_DATABASE_URL to a dedicated database ending in _test. All test data will be deleted.',
  );
process.env.DATABASE_URL = url;
process.env.APP_ORIGIN = 'http://localhost:3300';
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
delete process.env.REGISTRATION_INVITE;
process.env.WORKER_SECRET = 'integration-worker-secret-not-production-2026';
process.env.MEDIA_ROOT = resolve('runtime/integration-media');
process.env.WORKER_URL = 'http://127.0.0.1:3212';
process.env.ENABLE_WHATSAPP = 'true';
const { db } = await import('../lib/db/client');
const { GET, POST, DELETE, PATCH } = await import('../app/api/[...path]/route');
const { createWorkerServer } = await import('../worker/http');
const { storageReady, filePath } = await import('../lib/storage/files');
const { processDownload, cleanup } = await import('../worker/jobs');
const { providerFor } = await import('../worker/sessions');
const { authStore } = await import('../worker/auth-store');
const { seal } = await import('../lib/security/crypto');
const { MockProvider, fixturePng } = await import('./mock-provider');
const { rateLimit } = await import('../lib/security/rate');
await db.user.deleteMany();
await db.rateBucket.deleteMany();
await db.workerHealth.deleteMany();
await storageReady();
const server = createWorkerServer(process.env.WORKER_SECRET, () => true);
await new Promise<void>((resolve) => server.listen(3212, '127.0.0.1', resolve));
await db.workerHealth.create({
  data: { id: 'primary', provider: 'mock-test-only', storageReady: true },
});
type Login = { cookie: string; csrf: string; userId: string };
let cases = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  cases++;
  console.log(`PASS ${name}`);
}
async function request(
  path: string,
  method = 'GET',
  data?: unknown,
  login?: Login,
  extra: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const req = new Request(`http://localhost:3300/api/${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:3300',
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(login ? { Cookie: login.cookie, 'X-CSRF-Token': login.csrf } : {}),
      ...extra,
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
    signal,
  });
  return ({ GET, POST, DELETE, PATCH } as Record<string, typeof GET>)[method](req);
}
async function payload<T>(res: Response): Promise<T> {
  return (await res.json()).data as T;
}
async function register(email: string): Promise<Login> {
  const response = await request('auth/register', 'POST', {
    email,
    name: 'TEST ONLY ' + email[0],
    password: 'test-password-long-enough',
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const data = await payload<{ csrf: string }>(response),
    me = await request('auth/me', 'GET', undefined, { cookie, csrf: data.csrf, userId: '' });
  const user = await payload<{ user: { id: string } }>(me);
  return { cookie, csrf: data.csrf, userId: user.user.id };
}
// Prisma may load the local .env during initialization; clear the obsolete variable after it.
delete process.env.REGISTRATION_INVITE;
const a = await register('a-integration@imhub.test'),
  b = await register('b-integration@imhub.test');
let statusId = '',
  mediaId = '',
  generation = 0;
let provider: InstanceType<typeof MockProvider>;
try {
  await check(
    'registration needs only name, email and password, with no invitation configuration',
    async () => {
      assert.equal(Boolean(process.env.REGISTRATION_INVITE), false);
      assert.notEqual(a.userId, b.userId);
      const duplicate = await request('auth/register', 'POST', {
        name: 'TEST DUPLICATE',
        email: 'a-integration@imhub.test',
        password: 'test-password-long-enough',
      });
      assert.equal(duplicate.status, 409);
      // An obsolete variable left on an existing deployment must not gate registration.
      process.env.REGISTRATION_INVITE = 'obsolete-test-value';
      const c = await register('c-integration@imhub.test');
      assert.ok(c.userId);
      delete process.env.REGISTRATION_INVITE;
    },
  );
  await check('health is public; all personal endpoints require authentication', async () => {
    assert.equal((await request('health')).status, 200);
    for (const path of [
      'dashboard',
      'wa/session',
      'statuses',
      'library',
      'history',
      'activity',
      'preferences',
      'events',
      `media/${randomUUID()}`,
    ])
      assert.equal((await request(path)).status, 401, path);
    for (const path of ['wa/connect', 'wa/disconnect', `statuses/${randomUUID()}/download`])
      assert.equal((await request(path, 'POST', {})).status, 401);
  });
  await check(
    'missing schema returns a specific safe error for readiness and registration',
    async () => {
      // This suite already enforces an isolated disposable _test database.
      await db.$executeRaw`ALTER TABLE "RateBucket" RENAME TO "RateBucket_schema_test"`;
      try {
        for (const response of [
          await request('health'),
          await request('auth/register', 'POST', {
            name: 'TEST SCHEMA',
            email: 'schema-test@imhub.test',
            password: 'test-password-long-enough',
          }),
        ]) {
          assert.equal(response.status, 503);
          const result = await response.json();
          assert.equal(result.error.code, 'DATABASE_NOT_READY');
          assert.ok(!JSON.stringify(result).includes('RateBucket'));
          assert.ok(!JSON.stringify(result).includes(process.env.DATABASE_URL!));
        }
      } finally {
        await db.$executeRaw`ALTER TABLE "RateBucket_schema_test" RENAME TO "RateBucket"`;
      }
      assert.equal((await request('health')).status, 200);
    },
  );
  await check('CSRF, origin and consent are enforced', async () => {
    assert.equal(
      (
        await request('wa/connect', 'POST', { consent: true, method: 'qr' }, a, {
          'X-CSRF-Token': '',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('wa/connect', 'POST', { consent: true, method: 'qr' }, a, {
          Origin: 'https://evil.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (await request('wa/connect', 'POST', { consent: false, method: 'qr' }, a)).status,
      400,
    );
    assert.equal(
      (await request('wa/connect', 'POST', { consent: true, method: 'code', phone: 'invalid' }, a))
        .status,
      400,
    );
  });
  await check('pairing challenge does not mean connected; only provider open does', async () => {
    assert.equal(
      (await request('wa/connect', 'POST', { consent: true, method: 'qr' }, a)).status,
      202,
    );
    const session = await db.waSession.findUniqueOrThrow({ where: { userId: a.userId } });
    generation = session.generation;
    assert.equal(session.state, 'CONNECTING');
    provider = providerFor(
      a.userId,
      generation,
      (_id, _gen, hooks) => new MockProvider(hooks),
    ) as InstanceType<typeof MockProvider>;
    await provider.connect('qr');
    const info = await payload<{ state: string; challenge: { value: string } }>(
      await request('wa/session', 'GET', undefined, a),
    );
    assert.equal(info.state, 'AWAITING_PAIRING');
    assert.ok(info.challenge.value.startsWith('TEST-ONLY'));
    const privateRow = await db.waSession.findUniqueOrThrow({ where: { userId: a.userId } });
    assert.ok(!privateRow.challengeCipher?.includes('TEST-ONLY'));
    assert.equal(
      (await payload<{ challenge: unknown }>(await request('wa/session', 'GET', undefined, b)))
        .challenge,
      null,
    );
    await provider.confirm();
    assert.equal(
      (await payload<{ state: string }>(await request('wa/session', 'GET', undefined, a))).state,
      'CONNECTED',
    );
  });
  await check('auth credentials survive a real child-process restart encrypted', async () => {
    const run = (mode: string) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'tests/auth-store-process.ts', mode, a.userId, String(generation)],
        { env: process.env },
      );
    const first = (await run('write')).stdout.trim(),
      second = (await run('read')).stdout.trim();
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
    const rows = await db.secret.findMany({ where: { userId: a.userId } });
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((s) => s.cipher.startsWith('v1.') && !s.cipher.includes('private')));
  });
  await check('deduplicated status ingestion persists only owner-scoped metadata', async () => {
    const status = {
      fingerprint: 'fixture-photo-1',
      contactName: 'TEST PHOTO',
      kind: 'PHOTO' as const,
      mime: 'image/png',
      duration: null,
      postedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      descriptor: {
        url: 'https://mmg.whatsapp.net/test.enc',
        mediaKey: new Uint8Array(32),
        fileSha256: createHash('sha256').update(fixturePng).digest(),
      },
      thumbnail: null,
    };
    await provider.emit(status);
    await provider.emit(status);
    const list = await payload<{ total: number; items: { id: string }[] }>(
      await request('statuses', 'GET', undefined, a),
    );
    assert.equal(list.total, 1);
    statusId = list.items[0].id;
    assert.equal(
      (await payload<{ total: number }>(await request('statuses', 'GET', undefined, b))).total,
      0,
    );
    const raw = await db.status.findUniqueOrThrow({ where: { id: statusId } });
    assert.ok(!raw.descriptorCipher?.includes('https:'));
    assert.equal((await request(`statuses/${statusId}`, 'GET', undefined, b)).status, 404);
    assert.equal(
      (await request(`statuses/${statusId}/download`, 'POST', undefined, b)).status,
      404,
    );
  });
  await check(
    'download jobs deduplicate concurrent requests and complete after actual file bytes exist',
    async () => {
      const responses = await Promise.all([
        request(`statuses/${statusId}/download`, 'POST', undefined, a),
        request(`statuses/${statusId}/download`, 'POST', undefined, a),
      ]);
      const values = await Promise.all(responses.map((r) => payload<{ jobId: string }>(r)));
      assert.equal(values[0].jobId, values[1].jobId);
      assert.equal(await db.media.count({ where: { userId: a.userId } }), 0);
      await processDownload(values[0].jobId, provider);
      const job = await db.downloadJob.findUniqueOrThrow({ where: { id: values[0].jobId } });
      assert.equal(job.state, 'COMPLETED');
      assert.equal(job.attempts, 1);
      const media = await db.media.findFirstOrThrow({ where: { userId: a.userId } });
      mediaId = media.id;
      assert.equal(media.bytes, fixturePng.length);
      assert.deepEqual(await readFile(filePath(media.storageKey)), fixturePng);
      assert.equal(
        (
          await payload<{ mediaId: string }>(
            await request(`statuses/${statusId}/download`, 'POST', undefined, a),
          )
        ).mediaId,
        mediaId,
      );
      assert.equal(await db.downloadJob.count({ where: { userId: a.userId } }), 1);
    },
  );
  await check(
    'HTTP file service streams exact bytes, ranges and safe filenames; rejects foreign owners',
    async () => {
      const res = await request(`media/${mediaId}/file?download=1`, 'GET', undefined, a);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-disposition')?.startsWith('attachment'));
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), fixturePng);
      const range = await request(`media/${mediaId}/file`, 'GET', undefined, a, {
        Range: 'bytes=0-9',
      });
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 10);
      assert.equal(
        (await request(`media/${mediaId}/file`, 'GET', undefined, a, { Range: 'bytes=9999-' }))
          .status,
        416,
      );
      for (const endpoint of [`media/${mediaId}`, `media/${mediaId}/file`])
        assert.equal((await request(endpoint, 'GET', undefined, b)).status, 404);
      assert.equal((await request(`media/${mediaId}`, 'DELETE', undefined, b)).status, 404);
      assert.equal((await fetch(`${process.env.WORKER_URL}/media/${mediaId}`)).status, 401);
      assert.equal(
        (
          await fetch(`${process.env.WORKER_URL}/media/${mediaId}`, {
            headers: {
              Authorization: `Bearer ${process.env.WORKER_SECRET}`,
              'X-User-Id': b.userId,
            },
          })
        ).status,
        404,
      );
    },
  );
  await check('search, filters and library counts use actual persisted records', async () => {
    assert.equal(
      (
        await payload<{ total: number }>(
          await request('statuses?filter=saved', 'GET', undefined, a),
        )
      ).total,
      1,
    );
    assert.equal(
      (
        await payload<{ total: number }>(
          await request('statuses?filter=unsaved', 'GET', undefined, a),
        )
      ).total,
      0,
    );
    assert.equal(
      (
        await payload<{ total: number }>(
          await request('statuses?filter=video', 'GET', undefined, a),
        )
      ).total,
      0,
    );
    assert.equal(
      (await payload<{ total: number }>(await request('library?q=status-', 'GET', undefined, a)))
        .total,
      1,
    );
    assert.equal(
      (await payload<{ total: number }>(await request('library?q=not-found', 'GET', undefined, a)))
        .total,
      0,
    );
    assert.equal(
      (await payload<{ total: number }>(await request('library', 'GET', undefined, b))).total,
      0,
    );
  });
  await check(
    'SSE emits only authenticated owner updates without challenges or session secrets',
    async () => {
      const controller = new AbortController();
      const res = await request('events', 'GET', undefined, a, {}, controller.signal),
        reader = res.body!.getReader();
      const first = await reader.read(),
        text = new TextDecoder().decode(first.value);
      assert.ok(text.includes('event: update'));
      assert.ok(!text.includes('TEST-ONLY-QR'));
      assert.ok(!text.includes(process.env.WORKER_SECRET!));
      assert.ok(!text.includes(b.userId));
      controller.abort();
      await reader.cancel();
    },
  );
  await check(
    'confirmed deletion hides media immediately and physically removes bytes during cleanup',
    async () => {
      const media = await db.media.findUniqueOrThrow({ where: { id: mediaId } });
      assert.equal((await request(`media/${mediaId}`, 'DELETE', undefined, a)).status, 202);
      assert.equal((await request(`media/${mediaId}/file`, 'GET', undefined, a)).status, 404);
      await cleanup();
      assert.equal(await db.media.count({ where: { id: mediaId } }), 0);
      await assert.rejects(readFile(filePath(media.storageKey)));
    },
  );
  await check('provider error and timeout become durable failed jobs; retry is safe', async () => {
    provider.mode = 'fail';
    let job = await payload<{ jobId: string }>(
      await request(`statuses/${statusId}/download`, 'POST', undefined, a),
    );
    await processDownload(job.jobId, provider);
    assert.equal(
      (await db.downloadJob.findUniqueOrThrow({ where: { id: job.jobId } })).errorCode,
      'MEDIA_UNAVAILABLE',
    );
    provider.mode = 'timeout';
    job = await payload<{ jobId: string }>(
      await request(`statuses/${statusId}/download`, 'POST', undefined, a),
    );
    await processDownload(job.jobId, provider);
    assert.equal(
      (await db.downloadJob.findUniqueOrThrow({ where: { id: job.jobId } })).errorCode,
      'DOWNLOAD_TIMEOUT',
    );
    provider.mode = 'ok';
    job = await payload<{ jobId: string }>(
      await request(`statuses/${statusId}/download`, 'POST', undefined, a),
    );
    await processDownload(job.jobId, provider);
    const stored = await db.downloadJob.findUniqueOrThrow({ where: { id: job.jobId } });
    assert.equal(stored.state, 'COMPLETED');
    assert.equal(stored.attempts, 4);
  });
  await check('automatic retention removes old media and expired descriptors', async () => {
    assert.equal(
      (await request('preferences', 'PATCH', { retentionDays: 1, notifications: false }, a)).status,
      200,
    );
    await db.media.updateMany({
      where: { userId: a.userId },
      data: { createdAt: new Date(Date.now() - 2 * 86400000) },
    });
    await db.status.update({
      where: { id: statusId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await cleanup();
    assert.equal(await db.media.count({ where: { userId: a.userId } }), 0);
    assert.equal(
      (await db.status.findUniqueOrThrow({ where: { id: statusId } })).descriptorCipher,
      null,
    );
    assert.equal(
      (await request(`statuses/${statusId}/download`, 'POST', undefined, a)).status,
      410,
    );
    assert.equal(
      (await request('preferences', 'PATCH', { retentionDays: 0, notifications: true }, a)).status,
      400,
    );
    assert.equal(
      (await payload<{ retentionDays: number }>(await request('preferences', 'GET', undefined, b)))
        .retentionDays,
      7,
    );
  });
  await check(
    'disconnect revokes secrets and generation-fences stale credential/event callbacks',
    async () => {
      const store = await authStore(a.userId, generation);
      assert.equal((await request('wa/disconnect', 'POST', undefined, a)).status, 200);
      await store.save();
      await store.state.keys.set({
        'pre-key': { '99': { public: Buffer.alloc(32), private: Buffer.alloc(32) } },
      });
      await provider.confirm();
      assert.equal(await db.secret.count({ where: { userId: a.userId } }), 0);
      const session = await db.waSession.findUniqueOrThrow({ where: { userId: a.userId } });
      assert.equal(session.state, 'DISCONNECTED');
      assert.equal(session.challengeCipher, null);
    },
  );
  await check('offline worker prevents connecting; disabled provider is explicit', async () => {
    await db.workerHealth.update({ where: { id: 'primary' }, data: { heartbeat: new Date(0) } });
    assert.equal(
      (await request('wa/connect', 'POST', { consent: true, method: 'qr' }, b)).status,
      503,
    );
    process.env.ENABLE_WHATSAPP = 'false';
    const res = await request('wa/connect', 'POST', { consent: true, method: 'qr' }, b);
    assert.equal((await res.json()).error.code, 'PROVIDER_DISABLED');
    process.env.ENABLE_WHATSAPP = 'true';
  });
  await check('rate limits are persistent and atomic across concurrent requests', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => rateLimit('isolated-test-limit', 5)),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 7);
  });
  await check(
    'malformed media identifiers and user URL injection cannot cause arbitrary fetches',
    async () => {
      assert.equal((await request('media/not-a-uuid/file', 'GET', undefined, a)).status, 404);
      assert.equal(
        (
          await request(
            'wa/connect',
            'POST',
            { consent: true, method: 'qr', url: 'http://169.254.169.254' },
            b,
          )
        ).status,
        400,
      );
      const record = seal('sensitive', `${a.userId}:scope`);
      assert.ok(!record.includes('sensitive'));
    },
  );
  await check(
    'password changes validate current password, rotate other login sessions, and logout revokes cookie',
    async () => {
      const second = await request('auth/login', 'POST', {
        email: 'a-integration@imhub.test',
        password: 'test-password-long-enough',
      });
      assert.equal(second.status, 200);
      assert.equal(
        (
          await request(
            'auth/password',
            'POST',
            { current: 'wrong-password-value', password: 'new-password-long-enough' },
            a,
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            'auth/password',
            'POST',
            { current: 'test-password-long-enough', password: 'new-password-long-enough' },
            a,
          )
        ).status,
        200,
      );
      assert.equal(await db.authSession.count({ where: { userId: a.userId } }), 1);
      assert.equal((await request('auth/logout', 'POST', undefined, a)).status, 200);
      assert.equal((await request('auth/me', 'GET', undefined, a)).status, 401);
    },
  );
  await check(
    'public error responses do not expose stack traces or internal credentials',
    async () => {
      const res = await request(`media/${randomUUID()}`, 'GET', undefined, b);
      const text = await res.text();
      assert.equal(res.status, 404);
      assert.ok(!text.includes('stack'));
      assert.ok(!text.includes(process.env.DATABASE_URL!));
      assert.ok(!text.includes(process.env.ENCRYPTION_KEY!));
    },
  );
  await mkdir('docs', { recursive: true });
  await writeFile(
    'docs/integration-result.json',
    JSON.stringify(
      {
        passed: cases,
        database: 'PostgreSQL 17 (isolated _test database)',
        provider: 'mock, no live account',
        authRestart: 'two child processes; encrypted state/Signal keys round-trip verified',
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n${cases} integration scenarios passed. No real WhatsApp account used.`);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.user.deleteMany();
  await db.workerHealth.deleteMany();
  await db.rateBucket.deleteMany();
  await db.$disconnect();
  await rm(process.env.MEDIA_ROOT!, { recursive: true, force: true });
}
