import { BufferJSON } from '@whiskeysockets/baileys';
import { db } from '../lib/db/client';
import { seal } from '../lib/security/crypto';
import type { ReceivedStatus } from './providers/types';
export async function ingest(userId: string, generation: number, status: ReceivedStatus) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "userId" FROM "WaSession" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    const session = await tx.waSession.findUnique({ where: { userId } });
    if (!session?.desired || session.generation !== generation) return;
    const { descriptor, thumbnail, ...data } = status;
    const result = await tx.status.createMany({
      skipDuplicates: true,
      data: {
        ...data,
        userId,
        thumbnail: thumbnail ? new Uint8Array(thumbnail) : null,
        descriptorCipher: seal(
          JSON.stringify(descriptor, BufferJSON.replacer),
          `${userId}:status:${data.fingerprint}`,
        ),
      },
    });
    if (result.count) await tx.activity.create({ data: { userId, kind: 'STATUS_RECEIVED' } });
  });
}
