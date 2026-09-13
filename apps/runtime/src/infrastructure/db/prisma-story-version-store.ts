import {Prisma, type PrismaClient} from '../../generated/prisma/client.js';
import type {StoryVersionStore, StoryVersionReadScope, StoryVersionWriteScope} from '../../ports/story-version-store.js';
import {createStoryDraftReadScope} from './prisma-story-draft-store.js';
import {withOwnerWrite} from './write-gate.js';

export function createStoryVersionReadScope(tx: Prisma.TransactionClient, ownerId: string): StoryVersionReadScope {
  return {
    ...createStoryDraftReadScope(tx, ownerId),
    ownerId,
    findStoryVersion: id => tx.storyVersion.findFirst({where: {id, ownerId}}),
    // Owner is checked on the root. Read all children to detect corrupt shadow ownership.
    findStoryCast: storyVersionId => tx.storyVersionCast.findMany({where: {storyVersionId}}),
    findStorySlots: storyVersionId => tx.storyVersionAsset.findMany({where: {storyVersionId}}),
  };
}

/** Compose this scope inside the future Experience transaction, never nest a transaction. */
export function createStoryVersionWriteScope(tx: Prisma.TransactionClient, ownerId: string): StoryVersionWriteScope {
  async function requireUnsealed(id: string) {
    const header = await tx.storyVersion.findFirst({where: {id, ownerId}, select: {sealedAt: true, contentHash: true}});
    if (!header) throw Error('STORY_VERSION_NOT_FOUND');
    if (header.sealedAt !== null || header.contentHash !== null) throw Error('STORY_VERSION_SEALED');
  }
  return {
    ...createStoryVersionReadScope(tx, ownerId),
    findStoryVersionBySource: (storyDraftId, sourceRevision) => tx.storyVersion.findUnique({
      where: {storyDraftId_sourceRevision: {storyDraftId, sourceRevision}},
    }),
    nextStoryVersionNo: async storyDraftId =>
      ((await tx.storyVersion.aggregate({where: {storyDraftId}, _max: {versionNo: true}}))._max.versionNo ?? 0) + 1,
    insertStoryVersion: async input => {
      await tx.storyVersion.create({data: {...input, ownerId, sealedAt: null, contentHash: null}});
    },
    insertStoryCast: async (storyVersionId, cast) => {
      if (!cast) return;
      await requireUnsealed(storyVersionId);
      await tx.storyVersionCast.create({data: {
        ...cast, ownerId, storyVersionId, slotKey: 'main', schemaVersion: 1,
        overrides: cast.overrides as unknown as Prisma.InputJsonValue,
      }});
    },
    insertStoryAssets: async (storyVersionId, assets) => {
      if (!assets.length) return;
      await requireUnsealed(storyVersionId);
      for (const asset of assets) await tx.storyVersionAsset.create({data: {
        ...asset, ownerId, storyVersionId, purpose: asset.slotKey,
      }});
    },
    sealStoryVersion: async (id, contentHash, sealedAt) => (await tx.storyVersion.updateMany({
      where: {id, ownerId, sealedAt: null, contentHash: null}, data: {contentHash, sealedAt},
    })).count,
  };
}

export class PrismaStoryVersionStore implements StoryVersionStore {
  constructor(private readonly db: PrismaClient) {}
  read<T>(ownerId: string, work: (scope: StoryVersionReadScope) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      if (!await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}}))
        throw Error('OWNER_UNAVAILABLE');
      return work(createStoryVersionReadScope(tx, ownerId));
    });
  }
  write<T>(ownerId: string, work: (scope: StoryVersionWriteScope) => Promise<T>): Promise<T> {
    return withOwnerWrite(this.db, ownerId, tx => work(createStoryVersionWriteScope(tx, ownerId)));
  }
}
