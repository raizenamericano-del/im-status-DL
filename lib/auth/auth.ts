import { randomBytes, scrypt as rawScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from '../db/client';
import { csrfFor, digest, safeEqual } from '../security/crypto';
import { AppError } from '../security/errors';
import { checkOrigin } from '../security/http';
const scrypt = promisify(rawScrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, value] = hash.split(':');
  return safeEqual(((await scrypt(password, salt, 64)) as Buffer).toString('hex'), value);
}
export function cookie(token: string, clear = false) {
  const secure = process.env.COOKIE_SECURE !== 'false';
  return `im_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secure ? '; Secure' : ''}`;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.authSession.create({
    data: { id: digest(token), userId, expiresAt: new Date(Date.now() + 604800000) },
  });
  return { token, csrf: csrfFor(token) };
}
export async function authenticate(req: Request, mutate = false) {
  const token = req.headers.get('cookie')?.match(/(?:^|;\s*)im_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) throw new AppError('UNAUTHENTICATED', 401);
  const session = await db.authSession.findUnique({
    where: { id: digest(token) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!session || session.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 401);
  if (mutate) {
    checkOrigin(req);
    if (!safeEqual(req.headers.get('x-csrf-token') ?? '', csrfFor(token)))
      throw new AppError('FORBIDDEN', 403);
  }
  return { user: session.user, sessionId: session.id, csrf: csrfFor(token) };
}
