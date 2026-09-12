export type StorySettings = {world: string; opening: string; genre: string; playerRole: string; worldRules: string[]; tone: string};
export type DraftDTO = {id: string; title: string; settings: StorySettings; schemaVersion: 1; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; archivedAt: string | null};
export type DraftCreate = {readonly datasetId: string; commandId: string; title: string; settings: StorySettings};
export type DraftUpdate = {readonly datasetId: string; commandId: string; id: string; expectedRevision: number; patch: {title?: string; settings?: StorySettings}};
export type DraftLifecycle = {readonly datasetId: string; commandId: string; id: string; expectedRevision: number};
export type DraftListInput = {limit?: number; deleted?: 'exclude' | 'only'; cursor?: string};
export type DraftPage = {items: DraftDTO[]; nextCursor: string | null};
export type DraftCommandResult = {data: DraftDTO; replayed: boolean};
/** Trusted internal caller only. This type is not authentication and is not an HTTP DTO. */
export type InternalOwnerContext = {readonly ownerId: string; readonly datasetId: string};
