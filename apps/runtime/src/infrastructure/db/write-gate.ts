import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';

/** First application statement takes SQLite's writer lock. Never perform network I/O in work. */
export async function withOwnerWrite<T>(db: PrismaClient, ownerId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    const gate = await tx.localProfile.updateMany({
      where: { id: ownerId, deletedAt: null },
      data: { writeEpoch: { increment: 1 } },
    });
    if (gate.count !== 1) throw new Error('OWNER_UNAVAILABLE');
    return work(tx);
  }, { maxWait: 1_000, timeout: 3_000 });
}
