import {createHash} from 'node:crypto';
import type {CharacterRecord, CharacterStore, CharacterReadScope, CharacterWriteScope} from '../ports/character-store.js';
import type {CharacterCreate, CharacterUpdate, CharacterLifecycle, CharacterListInput, CharacterPage, CharacterDTO, CharacterCommandResult} from '../contracts/character-template.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {fields, parseOwner} from '../contracts/story-draft-validation.js';
import {parseCreate, parseUpdate, parseLifecycle, parseId, parseName, parseSettings, parsePortrait, parseList} from '../contracts/character-template-validation.js';
import {isTimestamp} from '../contracts/primitives.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';

// Library templates only; portrait references are validated inside the owner write transaction. Frozen versions are never mutated.
function dto(character: CharacterRecord): CharacterDTO {
  try {
    if (character.schemaVersion !== 1 || !Number.isSafeInteger(character.revision) || character.revision < 1 || character.revision > 2147483647) throw new Error();
    return {id: parseId(character.id), name: parseName(character.name), settings: parseSettings(character.settings), portraitAssetId: parsePortrait(character.portraitAssetId), schemaVersion: 1,
      revision: character.revision, createdAt: character.createdAt.toISOString(), updatedAt: character.updatedAt.toISOString(),
      deletedAt: character.deletedAt?.toISOString() ?? null, archivedAt: character.archivedAt?.toISOString() ?? null};
  } catch {throw new Error('STORED_CHARACTER_INVALID');}
}
function receiptDTO(value: unknown): CharacterDTO {
  try {
    fields(value, ['id', 'name', 'settings', 'portraitAssetId', 'schemaVersion', 'revision', 'createdAt', 'updatedAt', 'deletedAt', 'archivedAt']);
    if (value.schemaVersion !== 1 || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 2147483647 ||
        !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || (value.deletedAt !== null && !isTimestamp(value.deletedAt)) ||
        (value.archivedAt !== null && !isTimestamp(value.archivedAt))) throw new Error();
    return {id: parseId(value.id), name: parseName(value.name), settings: parseSettings(value.settings), portraitAssetId: parsePortrait(value.portraitAssetId), schemaVersion: 1,
      revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt, deletedAt: value.deletedAt, archivedAt: value.archivedAt};
  } catch {throw new Error('COMMAND_RECEIPT_INVALID');}
}
async function portrait(scope: CharacterWriteScope, id: string | null) {
  if (id !== null && !await scope.hasReadyPortrait(id)) throw new Error('INVALID_CHARACTER_PORTRAIT');
}
async function requiredCharacter(scope: CharacterReadScope, id: string, includeDeleted = false): Promise<CharacterRecord> {
  const character = await scope.findCharacter(id, includeDeleted);
  if (!character) throw new Error('CHARACTER_NOT_FOUND');
  return character;
}

/** Historical receipt, not current resource state. Validation/canonicalization happens before this boundary. */
async function writeCommand(store: CharacterStore, owner: InternalOwnerContext, commandId: string, action: string,
  payload: CharacterCreate | CharacterUpdate | CharacterLifecycle, services: RuntimeServices,
  work: (scope: CharacterWriteScope) => Promise<CharacterDTO>): Promise<CharacterCommandResult> {
  if (payload.datasetId !== owner.datasetId) throw new Error('DATASET_CHANGED');
  const {ownerId, datasetId} = owner;
  const commandType = `authoring.character.${action}.v1`;
  const payloadHash = createHash('sha256').update(JSON.stringify([commandType, ownerId, datasetId, payload])).digest('hex');
  return store.write(ownerId, async scope => {
    const receipt = await scope.findReceipt(commandId);
    if (receipt) {
      if (receipt.commandType !== commandType || receipt.payloadHash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      if (receipt.schemaVersion !== 1) throw new Error('COMMAND_RECEIPT_INVALID');
      const data = receiptDTO(receipt.response);
      if ('id' in payload && data.id !== payload.id) throw new Error('COMMAND_RECEIPT_INVALID');
      return {data, replayed: true};
    }
    const data = await work(scope);
    await scope.insertReceipt({id: nextId(services), commandId, commandType, payloadHash,
      schemaVersion: 1, response: data, createdAt: new Date(data.updatedAt)});
    return {data, replayed: false};
  });
}

export async function createCharacter(store: CharacterStore, owner: InternalOwnerContext, input: CharacterCreate, services = systemServices): Promise<CharacterCommandResult> {
  parseOwner(owner); const value = parseCreate(input);
  return writeCommand(store, owner, value.commandId, 'create', value, services, async scope => {
    await portrait(scope, value.portraitAssetId);
    const now = currentTime(services);
    return dto(await scope.insertCharacter({id: nextId(services), name: value.name, settings: value.settings, portraitAssetId: value.portraitAssetId,
      createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null, revision: 1, schemaVersion: 1}));
  });
}
async function mutableCharacter(scope: CharacterReadScope, id: string, expectedRevision: number, restoring = false) {
  const character = await requiredCharacter(scope, id, restoring);
  if (character.revision !== expectedRevision) throw new Error('REVISION_CONFLICT');
  if (restoring && character.deletedAt === null) throw new Error('CHARACTER_NOT_DELETED');
  if (character.revision >= 2147483647) throw new Error('REVISION_EXHAUSTED');
  dto(character); // Refuse unknown/corrupt stored settings rather than overwriting them.
  return character;
}
export async function updateCharacter(store: CharacterStore, owner: InternalOwnerContext, input: CharacterUpdate, services = systemServices): Promise<CharacterCommandResult> {
  parseOwner(owner); const value = parseUpdate(input);
  return writeCommand(store, owner, value.commandId, 'update', value, services, async scope => {
    const character = await mutableCharacter(scope, value.id, value.expectedRevision);
    const changed = await scope.compareAndSwapCharacter({id: value.id, expectedRevision: value.expectedRevision, deleted: 'exclude',
      patch: value.patch, updatedAt: currentTime(services, character.updatedAt)});
    if (changed !== 1) throw new Error('REVISION_CONFLICT');
    await portrait(scope, value.patch.portraitAssetId !== undefined ? value.patch.portraitAssetId : character.portraitAssetId);
    return dto(await requiredCharacter(scope, value.id, true));
  });
}
async function lifecycle(store: CharacterStore, owner: InternalOwnerContext, input: CharacterLifecycle, restoring: boolean, services: RuntimeServices) {
  parseOwner(owner); const value = parseLifecycle(input);
  return writeCommand(store, owner, value.commandId, restoring ? 'restore' : 'delete', value, services, async scope => {
    const character = await mutableCharacter(scope, value.id, value.expectedRevision, restoring);
    const now = currentTime(services, character.updatedAt);
    const changed = await scope.compareAndSwapCharacter({id: value.id, expectedRevision: value.expectedRevision, deleted: restoring ? 'only' : 'exclude',
      patch: {deletedAt: restoring ? null : now}, updatedAt: now});
    if (changed !== 1) throw new Error('REVISION_CONFLICT');
    // Deletion removes a live reference; restore must revalidate it. Receipts remain historical.
    if (restoring) await portrait(scope, character.portraitAssetId);
    return dto(await requiredCharacter(scope, value.id, true));
  });
}
export async function deleteCharacter(store: CharacterStore, owner: InternalOwnerContext, input: CharacterLifecycle, services = systemServices): Promise<CharacterCommandResult> {
  return lifecycle(store, owner, input, false, services);
}
export async function restoreCharacter(store: CharacterStore, owner: InternalOwnerContext, input: CharacterLifecycle, services = systemServices): Promise<CharacterCommandResult> {
  return lifecycle(store, owner, input, true, services);
}
export async function getCharacter(store: CharacterStore, owner: InternalOwnerContext, id: string, includeDeleted = false): Promise<CharacterDTO> {
  const ownerId = parseOwner(owner); parseId(id);
  if (typeof includeDeleted !== 'boolean') throw new Error('INVALID_CHARACTER_QUERY');
  return store.read(ownerId, async scope => dto(await requiredCharacter(scope, id, includeDeleted)));
}

type Cursor = {version: 1; q: string; ownerId: string; datasetId: string; deleted: 'exclude' | 'only'; updatedAt: string; id: string};
function readCursor(raw: string, ownerId: string, datasetId: string, deleted: 'exclude' | 'only', q: string): Cursor {
  try {
    if (!raw || raw.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(raw)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    fields(value, ['version', 'ownerId', 'datasetId', 'q', 'deleted', 'updatedAt', 'id']);
    if (value.version !== 1 || value.ownerId !== ownerId || value.datasetId !== datasetId || value.q !== q || value.deleted !== deleted || !isTimestamp(value.updatedAt)) throw new Error();
    return {version: 1, ownerId, datasetId, q, deleted, updatedAt: value.updatedAt, id: parseId(value.id)};
  } catch {throw new Error('INVALID_CURSOR');}
}
export async function listCharacters(store: CharacterStore, owner: InternalOwnerContext, input: CharacterListInput = {}): Promise<CharacterPage> {
  const ownerId = parseOwner(owner), value = parseList(input), {datasetId} = owner;
  const {limit, deleted, q} = value;
  const cursor = value.cursor !== undefined ? readCursor(value.cursor, ownerId, datasetId, deleted, q) : null;
  return store.read(ownerId, async scope => {
    const rows = await scope.listCharacters({deleted, q, take: limit + 1,
      ...(cursor ? {before: {updatedAt: new Date(cursor.updatedAt), id: cursor.id}} : {})});
    const totalMatching = await scope.countCharacters({deleted, q});
    const items = rows.slice(0, limit).map(dto), last = items.at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({version: 1, ownerId, datasetId, q, deleted, updatedAt: last.updatedAt, id: last.id} satisfies Cursor)).toString('base64url') : null;
    return {items, nextCursor, totalMatching};
  });
}
