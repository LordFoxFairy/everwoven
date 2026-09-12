import type {Prisma, PrismaClient} from '../../generated/prisma/client.js';
import type {StoryDraftReadScope, StoryDraftStore, StoryDraftWriteScope} from '../../ports/story-draft-store.js';
import {withOwnerWrite} from './write-gate.js';

// Explicit projection: never expose ownership or assert unvalidated JSON into a DTO.
const draftSelect = {
  id: true, title: true, settings: true, schemaVersion: true, revision: true,
  createdAt: true, updatedAt: true, deletedAt: true, archivedAt: true,
} satisfies Prisma.StoryDraftSelect;

function readScope(tx: Prisma.TransactionClient, ownerId: string): StoryDraftReadScope {
  return {
    findDraft: (id, includeDeleted = false) => tx.storyDraft.findFirst({
      where: {id, ownerId, ...(includeDeleted ? {} : {deletedAt: null})}, select: draftSelect,
    }),
    listDrafts: ({deleted, take, before}) => tx.storyDraft.findMany({
      where: {ownerId, deletedAt: deleted === 'only' ? {not: null} : null,
        ...(before ? {OR: [{updatedAt: {lt: before.updatedAt}}, {updatedAt: before.updatedAt, id: {lt: before.id}}]} : {})},
      orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], take, select: draftSelect,
    }),
  };
}

function writeScope(tx: Prisma.TransactionClient, ownerId: string): StoryDraftWriteScope {
  return {
    ...readScope(tx, ownerId),
    findReceipt: commandId => tx.commandReceipt.findUnique({
      where: {ownerId_commandId: {ownerId, commandId}},
      select: {commandType: true, payloadHash: true, schemaVersion: true, response: true},
    }),
    insertDraft: draft => tx.storyDraft.create({data: {
      id: draft.id, ownerId, title: draft.title, settings: draft.settings, schemaVersion: draft.schemaVersion,
      revision: draft.revision, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
      deletedAt: draft.deletedAt, archivedAt: draft.archivedAt,
    }, select: draftSelect}),
    compareAndSwapDraft: async ({id, expectedRevision, deleted, patch, updatedAt}) => {
      const changed = await tx.storyDraft.updateMany({
        where: {id, ownerId, revision: expectedRevision, deletedAt: deleted === 'only' ? {not: null} : null},
        data: {
          ...(patch.title !== undefined ? {title: patch.title} : {}),
          ...(patch.settings !== undefined ? {settings: patch.settings} : {}),
          ...(patch.deletedAt !== undefined ? {deletedAt: patch.deletedAt} : {}),
          updatedAt, revision: {increment: 1},
        },
      });
      return changed.count;
    },
    insertReceipt: async receipt => {
      await tx.commandReceipt.create({data: {
        id: receipt.id, ownerId, commandId: receipt.commandId, commandType: receipt.commandType,
        payloadHash: receipt.payloadHash, schemaVersion: receipt.schemaVersion,
        response: receipt.response, createdAt: receipt.createdAt,
      }});
    },
  };
}

/** Database lifecycle/bootstrap belongs to the host; callbacks do not perform external I/O. */
export class PrismaStoryDraftStore implements StoryDraftStore {
  constructor(private readonly db: PrismaClient) {}

  read<T>(ownerId: string, work: (scope: StoryDraftReadScope) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      if (!await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}})) {
        throw new Error('OWNER_UNAVAILABLE');
      }
      return work(readScope(tx, ownerId));
    });
  }

  write<T>(ownerId: string, work: (scope: StoryDraftWriteScope) => Promise<T>): Promise<T> {
    return withOwnerWrite(this.db, ownerId, tx => work(writeScope(tx, ownerId)));
  }
}
