export type CharacterSettings = {personality: string; appearance: string; speakingStyle: string; boundaries: string};
export type CharacterDTO = {
  id: string; name: string; settings: CharacterSettings; portraitAssetId: string | null; schemaVersion: 1; revision: number;
  createdAt: string; updatedAt: string; deletedAt: string | null; archivedAt: string | null;
};
export type CharacterCreate = {readonly datasetId: string; commandId: string; name: string; settings: CharacterSettings; portraitAssetId: string | null};
export type CharacterUpdate = {readonly datasetId: string; commandId: string; id: string; expectedRevision: number;
  patch: {name?: string; settings?: CharacterSettings; portraitAssetId?: string | null}};
export type CharacterLifecycle = {readonly datasetId: string; commandId: string; id: string; expectedRevision: number};
export type CharacterListInput = {limit?: number; deleted?: 'exclude' | 'only'; q?: string; cursor?: string};
export type CharacterPage = {items: CharacterDTO[]; nextCursor: string | null; totalMatching: number};
export type CharacterCommandResult = {data: CharacterDTO; replayed: boolean};
