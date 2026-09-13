import {Prisma, type PrismaClient} from '../../generated/prisma/client.js';
import type {
  StoryDraftStore,
  StoryDraftReadScope,
  StoryDraftWriteScope,
  StoryDraftFilter,
  StoryDraftListQuery,
  StorySummaryRecord,
} from '../../ports/story-draft-store.js';
import {withOwnerWrite} from './write-gate.js';
const draftSelect = {
  id: true,
  title: true,
  settings: true,
  schemaVersion: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  archivedAt: true,
} satisfies Prisma.StoryDraftSelect;
/** Literal contains (not LIKE wildcards). Identical predicate for page and total count. */
export function storyFilterSQL(ownerId: string, filter: StoryDraftFilter) {
  return Prisma.sql`s.owner_id=${ownerId} AND s.deleted_at ${filter.deleted === 'only' ? Prisma.sql`IS NOT NULL` : Prisma.sql`IS NULL`} AND instr(s.title,${filter.q})>0 ${filter.genre !== undefined ? Prisma.sql`AND json_extract(s.settings,'$.genre')=${filter.genre}` : Prisma.empty}`;
}
export function storyListSQL(ownerId: string, query: StoryDraftListQuery) {
  return Prisma.sql`SELECT s.id,s.title,json_extract(s.settings,'$.genre') AS genre,s.revision,s.schema_version AS schemaVersion,s.created_at AS createdAt,s.updated_at AS updatedAt,s.deleted_at AS deletedAt,s.archived_at AS archivedAt,
 CASE WHEN c.id IS NULL THEN NULL WHEN json_type(c.overrides,'$.name') IS NOT NULL THEN json_extract(c.overrides,'$.name') ELSE v.name END AS mainCharacterName,
 a.asset_id AS coverAssetId,
 c.id AS castId,c.owner_id AS castOwner,c.schema_version AS castSchema,
 json_type(c.overrides,'$.name') AS castNameType,
 v.id AS versionId,v.owner_id AS versionOwner,v.schema_version AS versionSchema,
 a.id AS coverLinkId,a.owner_id AS coverOwner,a.purpose AS coverPurpose
 FROM story_drafts s LEFT JOIN story_draft_cast c ON c.story_draft_id=s.id AND c.slot_key='main'
 LEFT JOIN character_versions v ON v.id=c.character_version_id
 LEFT JOIN story_draft_assets a ON a.story_draft_id=s.id AND a.slot_key='cover'
 WHERE ${storyFilterSQL(ownerId, query)} ${query.before ? Prisma.sql`AND (s.updated_at<${query.before.updatedAt} OR (s.updated_at=${query.before.updatedAt} AND s.id<${query.before.id}))` : Prisma.empty}
 ORDER BY s.updated_at DESC,s.id DESC LIMIT ${query.take}`;
}
export function createStoryDraftReadScope(tx: Prisma.TransactionClient, ownerId: string): StoryDraftReadScope {
  return {
    findDraft: (id, includeDeleted = false) =>
      tx.storyDraft.findFirst({
        where: {id, ownerId, ...(includeDeleted ? {} : {deletedAt: null})},
        select: draftSelect,
      }),
    listDrafts: async (query) => {
      type StoredDate = string | number | bigint;
      type Row = Omit<StorySummaryRecord, 'createdAt' | 'updatedAt' | 'deletedAt' | 'archivedAt'> & {
        createdAt: StoredDate;
        updatedAt: StoredDate;
        deletedAt: StoredDate | null;
        archivedAt: StoredDate | null;
        castId: string | null;
        castOwner: string | null;
        castSchema: number | null;
        castNameType: string | null;
        versionId: string | null;
        versionOwner: string | null;
        versionSchema: number | null;
        coverLinkId: string | null;
        coverOwner: string | null;
        coverPurpose: string | null;
      };
      const rows = await tx.$queryRaw<Row[]>(storyListSQL(ownerId, query));
      const date = (value: StoredDate) => new Date(typeof value === 'bigint' ? Number(value) : value);
      return rows.map((row) => {
        // A missing/foreign frozen version is corruption, never a character-less summary.
        // Only small projection metadata is inspected here; detail validates the full snapshot.
        const {
          castId,
          castOwner,
          castSchema,
          castNameType,
          versionId,
          versionOwner,
          versionSchema,
          coverLinkId,
          coverOwner,
          coverPurpose,
          ...r
        } = row;
        if (
          castId !== null &&
          (castOwner !== ownerId ||
            castSchema !== 1 ||
            versionId === null ||
            versionOwner !== ownerId ||
            versionSchema !== 1 ||
            (castNameType !== null && castNameType !== 'text') ||
            typeof r.mainCharacterName !== 'string')
        )
          throw Error('STORED_STORY_INVALID');
        if (coverLinkId !== null && (coverOwner !== ownerId || coverPurpose !== 'cover'))
          throw Error('STORED_STORY_INVALID');
        return {
          ...r,
          createdAt: date(r.createdAt),
          updatedAt: date(r.updatedAt),
          deletedAt: r.deletedAt === null ? null : date(r.deletedAt),
          archivedAt: r.archivedAt === null ? null : date(r.archivedAt),
        };
      });
    },
    countDrafts: async (filter) => {
      const result = await tx.$queryRaw<{n: bigint}[]>(
        Prisma.sql`SELECT COUNT(*) AS n FROM story_drafts s WHERE ${storyFilterSQL(ownerId, filter)}`,
      );
      return Number(result[0]!.n);
    },
    // Root is already owner-checked. Read all its links to detect corrupt shadow ownership/slots.
    findCast: (storyDraftId) => tx.storyDraftCast.findMany({where: {storyDraftId}}),
    findSlots: (storyDraftId) => tx.storyDraftAsset.findMany({where: {storyDraftId}}),
    findVersion: (id) => tx.characterVersion.findFirst({where: {id, ownerId}}),
    findAsset: (id) => tx.asset.findFirst({where: {id, ownerId}}),
  };
}
function writeScope(tx: Prisma.TransactionClient, ownerId: string): StoryDraftWriteScope {
  return {
    ...createStoryDraftReadScope(tx, ownerId),
    findReceipt: (commandId) =>
      tx.commandReceipt.findUnique({
        where: {ownerId_commandId: {ownerId, commandId}},
        select: {id: true, commandType: true, payloadHash: true, schemaVersion: true, response: true},
      }),
    insertDraft: (input) => tx.storyDraft.create({data: {...input, ownerId}, select: draftSelect}),
    compareAndSwapDraft: async ({id, expectedRevision, deleted, patch, updatedAt}) =>
      (
        await tx.storyDraft.updateMany({
          where: {id, ownerId, revision: expectedRevision, deletedAt: deleted === 'only' ? {not: null} : null},
          data: {
            ...(patch.title !== undefined ? {title: patch.title} : {}),
            ...(patch.settings !== undefined ? {settings: patch.settings} : {}),
            ...(patch.deletedAt !== undefined ? {deletedAt: patch.deletedAt} : {}),
            updatedAt,
            revision: {increment: 1},
          },
        })
      ).count,
    insertReceipt: async (input) => {
      await tx.commandReceipt.create({
        data: {...input, ownerId, response: input.response as unknown as Prisma.InputJsonValue},
      });
    },
    findTemplate: (id) => tx.characterTemplate.findFirst({where: {id, ownerId}}),
    // An owner-checked template identity precedes this unique lookup; mismatched stored owner must fail.
    findVersionBySource: (characterTemplateId, sourceRevision) =>
      tx.characterVersion.findUnique({
        where: {characterTemplateId_sourceRevision: {characterTemplateId, sourceRevision}},
      }),
    nextVersionNo: async (characterTemplateId) =>
      ((await tx.characterVersion.aggregate({where: {characterTemplateId}, _max: {versionNo: true}}))._max.versionNo ??
        0) + 1,
    insertVersion: (input) => tx.characterVersion.create({data: input}),
    insertTemplate: (input) => tx.characterTemplate.create({data: input}),
    updateTemplate: async (id, revision, input) =>
      (
        await tx.characterTemplate.updateMany({
          where: {id, ownerId, scope: 'story', revision, deletedAt: null},
          data: {...input, revision: {increment: 1}},
        })
      ).count,
    writeCast: async (storyDraftId, cast) => {
      if (!cast) {
        await tx.storyDraftCast.deleteMany({where: {storyDraftId, ownerId, slotKey: 'main'}});
        return;
      }
      const data = {
        characterVersionId: cast.characterVersionId,
        overrides: cast.overrides as unknown as Prisma.InputJsonValue,
        schemaVersion: 1,
      };
      await tx.storyDraftCast.upsert({
        where: {storyDraftId_slotKey: {storyDraftId, slotKey: 'main'}},
        create: {id: cast.id, storyDraftId, ownerId, slotKey: 'main', createdAt: cast.createdAt, ...data},
        update: data,
      });
    },
    writeSlots: async (storyDraftId, slots, newId, createdAt) => {
      for (const slotKey of ['cover', 'opening', 'character'] as const) {
        const assetId = slots[slotKey];
        if (assetId === null) {
          await tx.storyDraftAsset.deleteMany({where: {storyDraftId, ownerId, slotKey}});
          continue;
        }
        await tx.storyDraftAsset.upsert({
          where: {storyDraftId_slotKey: {storyDraftId, slotKey}},
          create: {id: newId(), ownerId, storyDraftId, slotKey, purpose: slotKey, assetId, createdAt},
          update: {assetId},
        });
      }
    },
  };
}
export class PrismaStoryDraftStore implements StoryDraftStore {
  constructor(private readonly db: PrismaClient) {}
  read<T>(ownerId: string, work: (scope: StoryDraftReadScope) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      if (!(await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}})))
        throw Error('OWNER_UNAVAILABLE');
      return work(createStoryDraftReadScope(tx, ownerId));
    });
  }
  write<T>(ownerId: string, work: (scope: StoryDraftWriteScope) => Promise<T>): Promise<T> {
    return withOwnerWrite(this.db, ownerId, (tx) => work(writeScope(tx, ownerId)));
  }
}
