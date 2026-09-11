import {createHash} from 'node:crypto';
import type {PrismaClient, Prisma, StoryDraft} from '../generated/prisma/client.js';
import type {DraftCreate, DraftUpdate, DraftLifecycle, DraftListInput, DraftPage, DraftDTO, DraftCommandResult, InternalOwnerContext} from '../contracts/story-draft.js';
import {fields, parseCreate, parseUpdate, parseLifecycle, parseOwner, parseId, parseTitle, parseSettings} from '../contracts/story-draft-validation.js';
import {isTimestamp} from '../contracts/primitives.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';

// This slice edits root title/settings only. No HTTP auth, relation binding or version sealing.
function dto(story: StoryDraft): DraftDTO {
  try {
    if (story.schemaVersion !== 1 || !Number.isSafeInteger(story.revision) || story.revision < 1 || story.revision > 2147483647) throw new Error();
    return {id: parseId(story.id), title: parseTitle(story.title), settings: parseSettings(story.settings), schemaVersion: 1,
      revision: story.revision, createdAt: story.createdAt.toISOString(), updatedAt: story.updatedAt.toISOString(),
      deletedAt: story.deletedAt?.toISOString() ?? null, archivedAt: story.archivedAt?.toISOString() ?? null};
  } catch {throw new Error('STORED_STORY_INVALID');}
}
function receiptDTO(value: Prisma.JsonValue): DraftDTO {
  try {
    fields(value, ['id', 'title', 'settings', 'schemaVersion', 'revision', 'createdAt', 'updatedAt', 'deletedAt', 'archivedAt']);
    if (value.schemaVersion !== 1 || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 2147483647 ||
        !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || (value.deletedAt !== null && !isTimestamp(value.deletedAt)) ||
        (value.archivedAt !== null && !isTimestamp(value.archivedAt))) throw new Error();
    return {id: parseId(value.id), title: parseTitle(value.title), settings: parseSettings(value.settings), schemaVersion: 1,
      revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt, deletedAt: value.deletedAt, archivedAt: value.archivedAt};
  } catch {throw new Error('COMMAND_RECEIPT_INVALID');}
}
async function activeOwner(tx: Prisma.TransactionClient, ownerId: string) {
  if (!await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}})) throw new Error('OWNER_UNAVAILABLE');
}

/** Historical receipt, not current resource state. Validation/canonicalization happens before this boundary. */
async function writeCommand(db: PrismaClient, ownerId: string, commandId: string, action: string,
  payload: DraftCreate | DraftUpdate | DraftLifecycle, services: RuntimeServices,
  work: (tx: Prisma.TransactionClient) => Promise<DraftDTO>): Promise<DraftCommandResult> {
  const commandType = `m0.story-root.${action}.v1`;
  const payloadHash = createHash('sha256').update(JSON.stringify([commandType, ownerId, payload])).digest('hex');
  return withOwnerWrite(db, ownerId, async tx => {
    const receipt = await tx.commandReceipt.findUnique({where: {ownerId_commandId: {ownerId, commandId}}});
    if (receipt) {
      if (receipt.commandType !== commandType || receipt.payloadHash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      if (receipt.schemaVersion !== 1) throw new Error('COMMAND_RECEIPT_INVALID');
      const data = receiptDTO(receipt.response);
      if ('id' in payload && data.id !== payload.id) throw new Error('COMMAND_RECEIPT_INVALID');
      return {data, replayed: true};
    }
    const data = await work(tx);
    await tx.commandReceipt.create({data: {id: nextId(services), ownerId, commandId, commandType, payloadHash,
      response: data, createdAt: new Date(data.updatedAt)}});
    return {data, replayed: false};
  });
}

export async function createDraft(db: PrismaClient, owner: InternalOwnerContext, input: DraftCreate, services = systemServices): Promise<DraftCommandResult> {
  const ownerId = parseOwner(owner), value = parseCreate(input);
  return writeCommand(db, ownerId, value.commandId, 'create', value, services, async tx => {
    const now = currentTime(services);
    return dto(await tx.storyDraft.create({data: {id: nextId(services), ownerId, title: value.title, settings: value.settings,
      createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null, revision: 1, schemaVersion: 1}}));
  });
}
async function mutableDraft(tx: Prisma.TransactionClient, ownerId: string, id: string, expectedRevision: number, restoring = false) {
  const story = await tx.storyDraft.findFirst({where: {id, ownerId, ...(restoring ? {} : {deletedAt: null})}});
  if (!story) throw new Error('STORY_NOT_FOUND');
  if (story.revision !== expectedRevision) throw new Error('REVISION_CONFLICT');
  if (restoring && story.deletedAt === null) throw new Error('STORY_NOT_DELETED');
  if (story.revision >= 2147483647) throw new Error('REVISION_EXHAUSTED');
  dto(story); // Refuse unknown/corrupt stored settings rather than overwriting them.
  return story;
}
export async function updateDraft(db: PrismaClient, owner: InternalOwnerContext, input: DraftUpdate, services = systemServices): Promise<DraftCommandResult> {
  const ownerId = parseOwner(owner), value = parseUpdate(input);
  return writeCommand(db, ownerId, value.commandId, 'update', value, services, async tx => {
    const story = await mutableDraft(tx, ownerId, value.id, value.expectedRevision);
    const changed = await tx.storyDraft.updateMany({where: {id: value.id, ownerId, revision: value.expectedRevision, deletedAt: null},
      data: {...value.patch, updatedAt: currentTime(services, story.updatedAt), revision: {increment: 1}}});
    if (changed.count !== 1) throw new Error('REVISION_CONFLICT');
    return dto(await tx.storyDraft.findUniqueOrThrow({where: {id: value.id}}));
  });
}
async function lifecycle(db: PrismaClient, owner: InternalOwnerContext, input: DraftLifecycle, restoring: boolean, services: RuntimeServices) {
  const ownerId = parseOwner(owner), value = parseLifecycle(input);
  return writeCommand(db, ownerId, value.commandId, restoring ? 'restore' : 'delete', value, services, async tx => {
    const story = await mutableDraft(tx, ownerId, value.id, value.expectedRevision, restoring);
    const now = currentTime(services, story.updatedAt);
    const changed = await tx.storyDraft.updateMany({where: {id: value.id, ownerId, revision: value.expectedRevision, deletedAt: restoring ? {not: null} : null},
      data: {deletedAt: restoring ? null : now, updatedAt: now, revision: {increment: 1}}});
    if (changed.count !== 1) throw new Error('REVISION_CONFLICT');
    return dto(await tx.storyDraft.findUniqueOrThrow({where: {id: value.id}}));
  });
}
export async function deleteDraft(db: PrismaClient, owner: InternalOwnerContext, input: DraftLifecycle, services = systemServices): Promise<DraftCommandResult> {
  return lifecycle(db, owner, input, false, services);
}
export async function restoreDraft(db: PrismaClient, owner: InternalOwnerContext, input: DraftLifecycle, services = systemServices): Promise<DraftCommandResult> {
  return lifecycle(db, owner, input, true, services);
}
export async function getDraft(db: PrismaClient, owner: InternalOwnerContext, id: string, includeDeleted = false): Promise<DraftDTO> {
  const ownerId = parseOwner(owner); parseId(id);
  if (typeof includeDeleted !== 'boolean') throw new Error('INVALID_STORY_QUERY');
  return db.$transaction(async tx => {
    await activeOwner(tx, ownerId);
    const story = await tx.storyDraft.findFirst({where: {id, ownerId, ...(includeDeleted ? {} : {deletedAt: null})}});
    if (!story) throw new Error('STORY_NOT_FOUND'); return dto(story);
  });
}

type Cursor = {version: 1; ownerId: string; deleted: 'exclude' | 'only'; updatedAt: string; id: string};
function readCursor(raw: string, ownerId: string, deleted: 'exclude' | 'only'): Cursor {
  try {
    if (!raw || raw.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(raw)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    fields(value, ['version', 'ownerId', 'deleted', 'updatedAt', 'id']);
    if (value.version !== 1 || value.ownerId !== ownerId || value.deleted !== deleted || !isTimestamp(value.updatedAt)) throw new Error();
    return {version: 1, ownerId, deleted, updatedAt: value.updatedAt, id: parseId(value.id)};
  } catch {throw new Error('INVALID_CURSOR');}
}
export async function listDrafts(db: PrismaClient, owner: InternalOwnerContext, input: DraftListInput = {}): Promise<DraftPage> {
  const ownerId = parseOwner(owner); fields(input, [], ['limit', 'deleted', 'cursor'], 'INVALID_STORY_QUERY');
  const limit = input.limit ?? 20, deleted = input.deleted ?? 'exclude';
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !['exclude', 'only'].includes(deleted) ||
      (Object.hasOwn(input, 'limit') && typeof input.limit !== 'number') || (Object.hasOwn(input, 'deleted') && typeof input.deleted !== 'string') ||
      (Object.hasOwn(input, 'cursor') && typeof input.cursor !== 'string')) throw new Error('INVALID_STORY_QUERY');
  const cursor = input.cursor !== undefined ? readCursor(input.cursor, ownerId, deleted) : null;
  return db.$transaction(async tx => {
    await activeOwner(tx, ownerId);
    const rows = await tx.storyDraft.findMany({where: {ownerId, deletedAt: deleted === 'only' ? {not: null} : null,
      ...(cursor ? {OR: [{updatedAt: {lt: new Date(cursor.updatedAt)}}, {updatedAt: new Date(cursor.updatedAt), id: {lt: cursor.id}}]} : {})},
      orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], take: limit + 1});
    const items = rows.slice(0, limit).map(dto), last = items.at(-1);
    // Cursor scopes navigation, not authorization. Every query still uses the trusted owner.
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({version: 1, ownerId, deleted, updatedAt: last.updatedAt, id: last.id} satisfies Cursor)).toString('base64url') : null;
    return {items, nextCursor};
  });
}
