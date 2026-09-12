import {Prisma, type PrismaClient} from '../../generated/prisma/client.js';
import type {CharacterFilter, CharacterReadScope, CharacterWriteScope, CharacterStore} from '../../ports/character-store.js';
import {withOwnerWrite} from './write-gate.js';

const characterSelect = {id: true, name: true, settings: true, portraitAssetId: true, schemaVersion: true, revision: true,
  createdAt: true, updatedAt: true, deletedAt: true, archivedAt: true} satisfies Prisma.CharacterTemplateSelect;
function filter(ownerId: string, query: CharacterFilter) {
  // Parameterized instr is literal Unicode substring search: '%'/'_' are not LIKE wildcards.
  return Prisma.sql`owner_id = ${ownerId} AND scope = 'library' AND deleted_at IS ${query.deleted === 'only' ? Prisma.sql`NOT NULL` : Prisma.sql`NULL`} AND instr(name, ${query.q}) > 0`;
}
function readScope(tx: Prisma.TransactionClient, ownerId: string): CharacterReadScope {
  return {
    findCharacter: (id, includeDeleted = false) => tx.characterTemplate.findFirst({where: {id, ownerId, scope: 'library', ...(includeDeleted ? {} : {deletedAt: null})}, select: characterSelect}),
    listCharacters: async query => {
      const before = query.before ? Prisma.sql`AND (updated_at < ${query.before.updatedAt} OR (updated_at = ${query.before.updatedAt} AND id < ${query.before.id}))` : Prisma.empty;
      const ids = await tx.$queryRaw<{id: string}[]>(Prisma.sql`SELECT id FROM character_templates WHERE ${filter(ownerId, query)} ${before} ORDER BY updated_at DESC, id DESC LIMIT ${query.take}`);
      return tx.characterTemplate.findMany({where: {ownerId, scope: 'library', id: {in: ids.map(row => row.id)}}, orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], select: characterSelect});
    },
    countCharacters: async query => {
      const [row] = await tx.$queryRaw<{total: bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM character_templates WHERE ${filter(ownerId, query)}`);
      return Number(row!.total);
    },
  };
}
function writeScope(tx: Prisma.TransactionClient, ownerId: string): CharacterWriteScope {
  return {
    ...readScope(tx, ownerId),
    findReceipt: commandId => tx.commandReceipt.findUnique({where: {ownerId_commandId: {ownerId, commandId}}, select: {commandType: true, payloadHash: true, schemaVersion: true, response: true}}),
    insertCharacter: input => tx.characterTemplate.create({data: {
      id: input.id, ownerId, scope: 'library', sourceStoryDraftId: null, name: input.name, settings: input.settings, portraitAssetId: input.portraitAssetId,
      schemaVersion: input.schemaVersion, revision: input.revision, createdAt: input.createdAt, updatedAt: input.updatedAt, deletedAt: input.deletedAt, archivedAt: input.archivedAt,
    }, select: characterSelect}),
    compareAndSwapCharacter: async ({id, expectedRevision, deleted, patch, updatedAt}) => {
      const changed = await tx.characterTemplate.updateMany({where: {id, ownerId, scope: 'library', revision: expectedRevision, deletedAt: deleted === 'only' ? {not: null} : null}, data: {
        ...(patch.name !== undefined ? {name: patch.name} : {}), ...(patch.settings !== undefined ? {settings: patch.settings} : {}),
        ...(patch.portraitAssetId !== undefined ? {portraitAssetId: patch.portraitAssetId} : {}), ...(patch.deletedAt !== undefined ? {deletedAt: patch.deletedAt} : {}),
        updatedAt, revision: {increment: 1},
      }}); return changed.count;
    },
    hasReadyPortrait: async id => Boolean(await tx.asset.findFirst({where: {id, ownerId, status: 'ready', deletedAt: null}, select: {id: true}})),
    insertReceipt: async receipt => {await tx.commandReceipt.create({data: {id: receipt.id, ownerId, commandId: receipt.commandId, commandType: receipt.commandType,
      payloadHash: receipt.payloadHash, schemaVersion: receipt.schemaVersion, response: receipt.response, createdAt: receipt.createdAt}});},
  };
}
export class PrismaCharacterStore implements CharacterStore {
  constructor(private readonly db: PrismaClient) {}
  read<T>(ownerId: string, work: (scope: CharacterReadScope) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      if (!await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}})) throw new Error('OWNER_UNAVAILABLE');
      return work(readScope(tx, ownerId));
    });
  }
  write<T>(ownerId: string, work: (scope: CharacterWriteScope) => Promise<T>): Promise<T> {
    return withOwnerWrite(this.db, ownerId, tx => work(writeScope(tx, ownerId)));
  }
}
