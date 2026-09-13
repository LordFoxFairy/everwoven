import type {StoryDraftReadScope, StoryDraftWriteScope} from '../../../src/ports/story-draft-store.js';
const unexpected = async (): Promise<never> => {
  throw Error('UNEXPECTED_STORY_PORT_CALL');
};
// Empty aggregate only; tests replace every operation whose behavior they exercise.
export const emptyRead: StoryDraftReadScope = {
  findDraft: unexpected,
  listDrafts: unexpected,
  countDrafts: unexpected,
  findCast: async () => [],
  findSlots: async () => [],
  findVersion: unexpected,
  findAsset: unexpected,
};
export const emptyWrite: StoryDraftWriteScope = {
  ...emptyRead,
  findReceipt: unexpected,
  insertDraft: unexpected,
  compareAndSwapDraft: unexpected,
  insertReceipt: unexpected,
  findTemplate: unexpected,
  findVersionBySource: unexpected,
  nextVersionNo: unexpected,
  insertVersion: unexpected,
  insertTemplate: unexpected,
  updateTemplate: unexpected,
  writeCast: unexpected,
  writeSlots: async (_id, slots) => {
    if (Object.values(slots).some((id) => id !== null)) throw Error('UNEXPECTED_STORY_PORT_CALL');
  },
};
