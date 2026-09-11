import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { withOwnerWrite } from './write-gate.js';

export type RenameStory = { ownerId: string; storyId: string; commandId: string; expectedRevision: number; title: string };
export type RenameResult = { id: string; title: string; revision: number; updatedAt: string };
const commandType = 'm0.internal.rename-story.v1';

function parseReceipt(value: Prisma.JsonValue): RenameResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.id !== 'string' || typeof value.title !== 'string' ||
      typeof value.revision !== 'number' || !Number.isInteger(value.revision) ||
      typeof value.updatedAt !== 'string') throw new Error('COMMAND_RECEIPT_INVALID');
  return { id: value.id, title: value.title, revision: value.revision, updatedAt: value.updatedAt };
}

/** Internal M0 probe/use-case, not the public updateStory HTTP implementation.
 * ownerId must come from the future authenticated host context, never an HTTP body.
 */
export async function renameStory(db: PrismaClient, input: RenameStory): Promise<RenameResult> {
  if (!input.title.trim() || [...input.title].length > 120 || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error('INVALID_STORY_UPDATE');
  }
  const payloadHash = createHash('sha256').update(JSON.stringify([
    commandType, input.ownerId, input.storyId, input.expectedRevision, input.title,
  ])).digest('hex');
  return withOwnerWrite(db, input.ownerId, async tx => {
    const receipt = await tx.commandReceipt.findUnique({
      where: { ownerId_commandId: { ownerId: input.ownerId, commandId: input.commandId } },
    });
    if (receipt) {
      if (receipt.commandType !== commandType || receipt.payloadHash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      return parseReceipt(receipt.response);
    }
    const story = await tx.storyDraft.findFirst({where: { id: input.storyId, ownerId: input.ownerId, deletedAt: null }});
    if (!story) throw new Error('STORY_NOT_FOUND');
    if (story.revision !== input.expectedRevision) throw new Error('REVISION_CONFLICT');
    const now = new Date();
    const result = await tx.storyDraft.updateMany({
      where: { id: input.storyId, ownerId: input.ownerId, deletedAt: null, revision: input.expectedRevision },
      data: { title: input.title, updatedAt: now, revision: { increment: 1 } },
    });
    if (result.count !== 1) throw new Error('REVISION_CONFLICT');
    const response = { id: input.storyId, title: input.title, revision: input.expectedRevision + 1, updatedAt: now.toISOString() };
    await tx.commandReceipt.create({data: {
      id: v7(), ownerId: input.ownerId, commandId: input.commandId, commandType,
      payloadHash, response, createdAt: now,
    }});
    return response;
  });
}
