import {createHash} from 'node:crypto';
import type {StoryDraftStore, StoryDraftWriteScope, StoryDraftFilter} from '../ports/story-draft-store.js';
import type {
  DraftCreate,
  DraftUpdate,
  DraftLifecycle,
  DraftGet,
  DraftListInput,
  DraftPage,
  DraftCommandResult,
  DraftDTO,
  InternalOwnerContext,
} from '../contracts/story-draft.js';
import {
  parseCreate,
  parseUpdate,
  parseLifecycle,
  parseGet,
  parseList,
  parseOwner,
  fields,
  parseId,
} from '../contracts/story-draft-validation.js';
import {parseDraftSummaryDTO, parseDraftPage} from '../contracts/story-draft-output.js';
import {isTimestamp} from '../contracts/primitives.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';
import {aggregateDTO, requiredDraft} from './story-draft-dto.js';
import {prepareMain, validateReferences} from './story-draft-cast.js';
import {
  replayStory,
  storyCommand,
  assertStoryResponse,
  type StoryAction,
  type StoryWrite,
} from './story-draft-receipts.js';
function check(owner: InternalOwnerContext, datasetId: string) {
  if (owner.datasetId !== datasetId) throw Error('DATASET_CHANGED');
}
async function command(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  action: StoryAction,
  input: StoryWrite,
  services: RuntimeServices,
  work: (scope: StoryDraftWriteScope) => Promise<DraftDTO>,
): Promise<DraftCommandResult> {
  check(owner, input.datasetId);
  return store.write(owner.ownerId, async (scope) => {
    const replay = await replayStory(scope, owner, action, input);
    if (replay) return replay;
    const data = await work(scope);
    try {
      assertStoryResponse(action, input, data);
    } catch {
      throw Error('STORED_STORY_INVALID');
    }
    const c = storyCommand(owner, action, input);
    // Atomic create identity: the root and its creation receipt share a server UUIDv7.
    await scope.insertReceipt({
      id: action === 'create' ? data.id : nextId(services),
      commandId: input.commandId,
      commandType: c.type,
      payloadHash: c.hash,
      schemaVersion: 1,
      response: data,
      createdAt: new Date(data.updatedAt),
    });
    return {data, replayed: false};
  });
}
export async function createDraft(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  input: DraftCreate,
  services = systemServices,
) {
  parseOwner(owner);
  const v = parseCreate(input);
  return command(store, owner, 'create', v, services, async (scope) => {
    const now = currentTime(services),
      id = nextId(services);
    const row = await scope.insertDraft({
      id,
      title: v.title,
      settings: v.settings,
      schemaVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      archivedAt: null,
    });
    const {main, sameBinding} = await prepareMain(scope, owner, id, v.mainCharacter, null, now, services);
    await validateReferences(scope, owner, null, main, v.assetSlots, sameBinding);
    if (main)
      await scope.writeCast(id, {
        id: nextId(services),
        characterVersionId: main.version.id,
        overrides: main.overrides,
        createdAt: now,
      });
    await scope.writeSlots(id, v.assetSlots, () => nextId(services), now);
    return aggregateDTO(scope, owner, row);
  });
}
async function mutable(
  scope: StoryDraftWriteScope,
  owner: InternalOwnerContext,
  id: string,
  revision: number,
  restore = false,
) {
  const row = await requiredDraft(scope, id, restore);
  if (row.revision !== revision) throw Error('REVISION_CONFLICT');
  if (restore && row.deletedAt === null) throw Error('STORY_NOT_DELETED');
  if (row.revision >= 2147483647) throw Error('REVISION_EXHAUSTED');
  return {row, dto: await aggregateDTO(scope, owner, row)};
}
export async function updateDraft(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  input: DraftUpdate,
  services = systemServices,
) {
  parseOwner(owner);
  const v = parseUpdate(input);
  return command(store, owner, 'update', v, services, async (scope) => {
    const {row, dto: old} = await mutable(scope, owner, v.id, v.expectedRevision),
      now = currentTime(services, row.updatedAt);
    const p = v.patch;
    const prepared = Object.hasOwn(p, 'mainCharacter')
      ? await prepareMain(scope, owner, v.id, p.mainCharacter!, old.mainCharacter, now, services)
      : {main: old.mainCharacter, sameBinding: true};
    const slots = p.assetSlots ?? {...old.assetSlots, ...(p.mainCharacter === null ? {character: null} : {})};
    await validateReferences(scope, owner, old, prepared.main, slots, prepared.sameBinding);
    if (
      (await scope.compareAndSwapDraft({
        id: v.id,
        expectedRevision: v.expectedRevision,
        deleted: 'exclude',
        patch: {
          ...(p.title !== undefined ? {title: p.title} : {}),
          ...(p.settings !== undefined ? {settings: p.settings} : {}),
        },
        updatedAt: now,
      })) !== 1
    )
      throw Error('REVISION_CONFLICT');
    if (Object.hasOwn(p, 'mainCharacter'))
      await scope.writeCast(
        v.id,
        prepared.main
          ? {
              id: nextId(services),
              characterVersionId: prepared.main.version.id,
              overrides: prepared.main.overrides,
              createdAt: now,
            }
          : null,
      );
    if (p.assetSlots !== undefined || p.mainCharacter === null)
      await scope.writeSlots(v.id, slots, () => nextId(services), now);
    return aggregateDTO(scope, owner, await requiredDraft(scope, v.id));
  });
}
async function lifecycle(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  input: DraftLifecycle,
  restore: boolean,
  services: RuntimeServices,
) {
  parseOwner(owner);
  const v = parseLifecycle(input);
  return command(store, owner, restore ? 'restore' : 'delete', v, services, async (scope) => {
    const {row} = await mutable(scope, owner, v.id, v.expectedRevision, restore),
      now = currentTime(services, row.updatedAt);
    if (
      (await scope.compareAndSwapDraft({
        id: v.id,
        expectedRevision: v.expectedRevision,
        deleted: restore ? 'only' : 'exclude',
        patch: {deletedAt: restore ? null : now},
        updatedAt: now,
      })) !== 1
    )
      throw Error('REVISION_CONFLICT');
    return aggregateDTO(scope, owner, await requiredDraft(scope, v.id, true));
  });
}
export async function deleteDraft(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  input: DraftLifecycle,
  services = systemServices,
) {
  return lifecycle(store, owner, input, false, services);
}
export async function restoreDraft(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  input: DraftLifecycle,
  services = systemServices,
) {
  return lifecycle(store, owner, input, true, services);
}
export async function getDraft(store: StoryDraftStore, owner: InternalOwnerContext, input: DraftGet) {
  parseOwner(owner);
  const v = parseGet(input);
  check(owner, v.datasetId);
  return store.read(owner.ownerId, async (scope) =>
    aggregateDTO(scope, owner, await requiredDraft(scope, v.id, v.includeDeleted)),
  );
}
export async function listDrafts(
  store: StoryDraftStore,
  owner: InternalOwnerContext,
  input: DraftListInput,
): Promise<DraftPage> {
  parseOwner(owner);
  const v = parseList(input);
  check(owner, v.datasetId);
  const filter: StoryDraftFilter = {deleted: v.deleted, q: v.q, ...(v.genre !== undefined ? {genre: v.genre} : {})};
  const scopeHash = createHash('sha256')
    .update(JSON.stringify([owner.ownerId, owner.datasetId, filter]))
    .digest('hex');
  let before: {updatedAt: Date; id: string} | undefined;
  if (v.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(v.cursor)) throw Error();
      const c: unknown = JSON.parse(Buffer.from(v.cursor, 'base64url').toString('utf8'));
      fields(c, ['protocolVersion', 'datasetId', 'scopeHash', 'updatedAt', 'id']);
      if (
        c.protocolVersion !== 1 ||
        c.datasetId !== owner.datasetId ||
        c.scopeHash !== scopeHash ||
        !isTimestamp(c.updatedAt)
      )
        throw Error();
      before = {updatedAt: new Date(c.updatedAt), id: parseId(c.id)};
    } catch {
      throw Error('INVALID_CURSOR');
    }
  }
  return store.read(owner.ownerId, async (scope) => {
    const totalMatching = await scope.countDrafts(filter),
      rows = await scope.listDrafts({...filter, take: v.limit + 1, ...(before ? {before} : {})});
    const items = rows.slice(0, v.limit).map((row) => {
        try {
          if (row.schemaVersion !== 1) throw Error();
          return parseDraftSummaryDTO({
            protocolVersion: 1,
            datasetId: owner.datasetId,
            id: row.id,
            title: row.title,
            genre: row.genre,
            mainCharacterName: row.mainCharacterName,
            coverAssetId: row.coverAssetId,
            revision: row.revision,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            deletedAt: row.deletedAt?.toISOString() ?? null,
            archivedAt: row.archivedAt?.toISOString() ?? null,
          });
        } catch {
          throw Error('STORED_STORY_INVALID');
        }
      }),
      last = items.at(-1);
    const nextCursor =
      rows.length > v.limit && last
        ? Buffer.from(
            JSON.stringify({
              protocolVersion: 1,
              datasetId: owner.datasetId,
              scopeHash,
              updatedAt: last.updatedAt,
              id: last.id,
            }),
          ).toString('base64url')
        : null;
    return parseDraftPage({protocolVersion: 1, datasetId: owner.datasetId, items, nextCursor, totalMatching});
  });
}
