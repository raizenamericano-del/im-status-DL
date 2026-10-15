import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db/client';
import { authenticate, cookie, createSession, passwordHash, verifyPassword } from '@/lib/auth/auth';
import { AppError, errorMessage } from '@/lib/security/errors';
import { publicServerError } from '@/lib/security/server-errors';
import { body, checkOrigin, pagination, uuid } from '@/lib/security/http';
import { rateLimit } from '@/lib/security/rate';
import {
  connect,
  dashboard,
  disconnect,
  mediaSelect,
  queueDownload,
  sessionInfo,
  workerCondition,
} from '@/lib/services/hub';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json({ data }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase().trim()),
    password: z.string().min(12).max(128),
  })
  .strict();
const registrationSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(60),
});
async function route(req: Request) {
  const url = new URL(req.url),
    parts = url.pathname.slice(5).split('/').filter(Boolean),
    path = parts.join('/'),
    method = req.method;
  if (path === 'health' && method === 'GET') {
    await db.$queryRaw`SELECT 1`;
    // Readiness includes the schema used by login/register rate limits, not only a DB socket.
    await db.rateBucket.findFirst({ where: { key: '__schema_health__' }, select: { key: true } });
    return json({ status: 'ok', service: 'im-status-hub' });
  }
  if (['auth/login', 'auth/register'].includes(path) && method === 'POST') {
    checkOrigin(req);
    // Global cap cannot be bypassed using spoofed X-Forwarded-For; per-account cap below.
    await rateLimit('auth:global', 120);
    const input = await body(req, path === 'auth/register' ? registrationSchema : loginSchema);
    await rateLimit(`auth:${input.email}`, 10, 300);
    let user = await db.user.findUnique({ where: { email: input.email } });
    if (path === 'auth/register') {
      const data = registrationSchema.parse(input);
      if (user) throw new AppError('EMAIL_EXISTS', 409);
      user = await db.user.create({
        data: {
          email: data.email,
          name: data.name,
          passwordHash: await passwordHash(data.password),
          whatsapp: { create: {} },
          preferences: { create: {} },
        },
      });
    } else {
      const valid = await verifyPassword(
        input.password,
        user?.passwordHash ?? '00000000000000000000000000000000:' + '0'.repeat(128),
      );
      if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 401);
    }
    const session = await createSession(user.id);
    return json({ user: { name: user.name, email: user.email }, csrf: session.csrf }, 200, {
      'Set-Cookie': cookie(session.token),
    });
  }
  const auth = await authenticate(req, !['GET', 'HEAD'].includes(method));
  const userId = auth.user.id;
  await rateLimit(`api:${userId}`, 600);
  if (path === 'auth/me' && method === 'GET') return json({ user: auth.user, csrf: auth.csrf });
  if (path === 'auth/password' && method === 'POST') {
    await rateLimit(`password:${userId}`, 5, 300);
    const data = await body(
      req,
      z
        .object({ current: z.string().min(12).max(128), password: z.string().min(12).max(128) })
        .strict(),
    );
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(data.current, user.passwordHash)))
      throw new AppError('INVALID_CREDENTIALS', 401);
    await db.$transaction([
      db.user.update({
        where: { id: userId },
        data: { passwordHash: await passwordHash(data.password) },
      }),
      db.authSession.deleteMany({ where: { userId, id: { not: auth.sessionId } } }),
    ]);
    return json({ ok: true });
  }
  if (path === 'auth/logout' && method === 'POST') {
    await db.authSession.delete({ where: { id: auth.sessionId } });
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', true) });
  }
  if (path === 'dashboard' && method === 'GET') return json(await dashboard(userId));
  if (path === 'wa/session' && method === 'GET') return json(await sessionInfo(userId, true));
  if (path === 'wa/connect' && method === 'POST') {
    await rateLimit(`connect:${userId}`, 5, 300);
    const data = await body(
      req,
      z
        .object({
          consent: z.literal(true),
          method: z.enum(['qr', 'code']),
          phone: z
            .string()
            .regex(/^[1-9]\d{7,14}$/)
            .optional(),
        })
        .strict()
        .refine((v) => v.method !== 'code' || !!v.phone),
    );
    return json(await connect(userId, data), 202);
  }
  if (path === 'wa/disconnect' && method === 'POST') {
    await disconnect(userId);
    return json({ ok: true });
  }
  if (path === 'statuses' && method === 'GET') {
    const { page, skip, take } = pagination(url),
      q = (url.searchParams.get('q') ?? '').slice(0, 100),
      filter = url.searchParams.get('filter') ?? 'all';
    const where: Prisma.StatusWhereInput = {
      userId,
      expiresAt: { gt: new Date() },
      descriptorCipher: { not: null },
      contactName: { contains: q, mode: 'insensitive' },
    };
    if (['photo', 'video'].includes(filter)) where.kind = filter === 'photo' ? 'PHOTO' : 'VIDEO';
    if (filter === 'saved') where.media = { is: { deleteRequestedAt: null } };
    if (filter === 'unsaved') where.media = { is: null };
    const [items, total] = await Promise.all([
      db.status.findMany({
        where,
        orderBy: { postedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          contactName: true,
          kind: true,
          mime: true,
          duration: true,
          postedAt: true,
          expiresAt: true,
          jobs: { select: { state: true, errorCode: true }, take: 1 },
          media: { select: { id: true, bytes: true, deleteRequestedAt: true } },
        },
      }),
      db.status.count({ where }),
    ]);
    return json({ items, total, page, pages: Math.ceil(total / take) });
  }
  if (parts[0] === 'statuses' && parts[1]) {
    const id = uuid(parts[1]);
    if (parts[2] === 'download' && method === 'POST') {
      await rateLimit(`download:${userId}`, 30);
      return json(await queueDownload(userId, id), 202);
    }
    if (parts[2] === 'thumbnail' && method === 'GET') {
      const status = await db.status.findFirst({
        where: { id, userId, expiresAt: { gt: new Date() } },
        select: { thumbnail: true },
      });
      if (!status?.thumbnail) throw new AppError('NOT_FOUND', 404);
      return new Response(new Uint8Array(status.thumbnail), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (!parts[2] && method === 'GET') {
      const item = await db.status.findFirst({
        where: { id, userId },
        select: {
          id: true,
          contactName: true,
          kind: true,
          mime: true,
          duration: true,
          expiresAt: true,
          postedAt: true,
          jobs: { select: { state: true, errorCode: true }, take: 1 },
          media: { select: mediaSelect },
        },
      });
      if (!item) throw new AppError('NOT_FOUND', 404);
      return json(item);
    }
  }
  if (path === 'library' && method === 'GET') {
    const { page, skip, take } = pagination(url),
      q = (url.searchParams.get('q') ?? '').slice(0, 100),
      filter = url.searchParams.get('filter');
    const where: Prisma.MediaWhereInput = {
      userId,
      deleteRequestedAt: null,
      filename: { contains: q, mode: 'insensitive' },
      ...(['photo', 'video'].includes(filter ?? '')
        ? { kind: filter === 'photo' ? 'PHOTO' : 'VIDEO' }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.media.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: url.searchParams.get('sort') === 'oldest' ? 'asc' : 'desc' },
        select: mediaSelect,
      }),
      db.media.count({ where }),
    ]);
    return json({ items, total, page, pages: Math.ceil(total / take) });
  }
  if (parts[0] === 'media' && parts[1]) {
    const id = uuid(parts[1]);
    const item = await db.media.findFirst({
      where: { id, userId, deleteRequestedAt: null },
      select: mediaSelect,
    });
    if (!item) throw new AppError('NOT_FOUND', 404);
    if (!parts[2] && method === 'GET') return json(item);
    if (!parts[2] && method === 'DELETE') {
      await db.media.updateMany({ where: { id, userId }, data: { deleteRequestedAt: new Date() } });
      return json({ state: 'DELETING' }, 202);
    }
    if (parts[2] === 'file' && method === 'GET') {
      await rateLimit(`files:${userId}`, 120);
      const secret = process.env.WORKER_SECRET;
      if (!secret || secret.length < 32) throw new AppError('WORKER_OFFLINE', 503);
      const range = req.headers.get('range');
      if (range && !/^bytes=\d*-\d*$/.test(range)) throw new AppError('INVALID_INPUT', 416);
      let upstream: Response;
      try {
        upstream = await fetch(`${process.env.WORKER_URL ?? 'http://127.0.0.1:3210'}/media/${id}`, {
          headers: {
            Authorization: `Bearer ${secret}`,
            'X-User-Id': userId,
            ...(range ? { Range: range } : {}),
          },
          signal: AbortSignal.timeout(60000),
          cache: 'no-store',
          redirect: 'error',
        });
      } catch {
        throw new AppError('WORKER_OFFLINE', 503);
      }
      if (![200, 206, 416].includes(upstream.status))
        throw new AppError(
          upstream.status === 404 ? 'MEDIA_UNAVAILABLE' : 'STORAGE_ERROR',
          upstream.status === 404 ? 410 : 503,
        );
      const headers: Record<string, string> = {
        'Content-Type': item.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${item.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      };
      for (const key of ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(key);
        if (value) headers[key] = value;
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }
  }
  if (path === 'history' && method === 'GET') {
    const { page, skip, take } = pagination(url);
    const [items, total] = await Promise.all([
      db.downloadJob.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          statusId: true,
          contactName: true,
          kind: true,
          state: true,
          attempts: true,
          errorCode: true,
          createdAt: true,
          updatedAt: true,
          finishedAt: true,
          status: { select: { media: { select: { id: true, deleteRequestedAt: true } } } },
        },
      }),
      db.downloadJob.count({ where: { userId } }),
    ]);
    return json({
      items: items.map((i) => ({ ...i, error: i.errorCode ? errorMessage(i.errorCode) : null })),
      total,
      page,
      pages: Math.ceil(total / take),
    });
  }
  if (path === 'activity' && method === 'GET') {
    const { page, skip, take } = pagination(url);
    const [items, total] = await Promise.all([
      db.activity.findMany({
        where: { userId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, createdAt: true },
      }),
      db.activity.count({ where: { userId } }),
    ]);
    return json({ items, total, page, pages: Math.ceil(total / take) });
  }
  if (path === 'preferences' && method === 'GET')
    return json(
      await db.preference.findUnique({
        where: { userId },
        select: { retentionDays: true, notifications: true },
      }),
    );
  if (path === 'preferences' && method === 'PATCH') {
    const data = await body(
      req,
      z
        .object({ retentionDays: z.number().int().min(1).max(90), notifications: z.boolean() })
        .strict(),
    );
    return json(
      await db.preference.update({
        where: { userId },
        data,
        select: { retentionDays: true, notifications: true },
      }),
    );
  }
  if (path === 'events' && method === 'GET') {
    await rateLimit(`sse:${userId}`, 20);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    const stream = new ReadableStream({
      start(controller) {
        const started = Date.now();
        let signature = '';
        const tick = async () => {
          if (stopped) return;
          try {
            const valid = await db.authSession.findUnique({ where: { id: auth.sessionId } });
            if (!valid || valid.expiresAt < new Date() || Date.now() - started > 240000) {
              stop();
              controller.close();
              return;
            }
            const [session, latest, jobs, media, worker] = await Promise.all([
              db.waSession.findUnique({
                where: { userId },
                select: { state: true, updatedAt: true },
              }),
              db.activity.findFirst({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                select: { id: true, kind: true, createdAt: true },
              }),
              db.downloadJob.aggregate({ where: { userId }, _max: { updatedAt: true } }),
              db.media.count({ where: { userId, deleteRequestedAt: null } }),
              workerCondition(),
            ]);
            const next = JSON.stringify({
              session,
              latest,
              jobs,
              media,
              workerOnline: worker.online,
            });
            if (next !== signature) {
              signature = next;
              if (!stopped)
                controller.enqueue(
                  encoder.encode(
                    `event: update\ndata: ${JSON.stringify({ activity: latest, at: new Date().toISOString() })}\n\n`,
                  ),
                );
            } else if (!stopped) controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            if (!stopped) {
              stop();
              controller.close();
            }
            return;
          }
          if (!stopped) timer = setTimeout(tick, 2500);
        };
        req.signal.addEventListener(
          'abort',
          () => {
            stop();
            try {
              controller.close();
            } catch {
              /* already cancelled */
            }
          },
          { once: true },
        );
        void tick();
      },
      cancel: stop,
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }
  throw new AppError('NOT_FOUND', 404);
}
async function handle(req: Request) {
  try {
    return await route(req);
  } catch (error) {
    const known = error instanceof AppError;
    const failure = publicServerError(error);
    const code = failure.code;
    // Never log provider errors, request bodies, credentials, tokens or database queries.
    if (!known) console.error(JSON.stringify({ event: 'api_error', code }));
    return Response.json(
      { error: { code, message: errorMessage(code) } },
      {
        status: failure.status,
        headers: {
          'Cache-Control': 'no-store',
          ...(code === 'RATE_LIMITED' ? { 'Retry-After': '60' } : {}),
        },
      },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
