import {describe, expect, it} from 'vitest';
import {createDraft, deleteDraft, getDraft, restoreDraft, updateDraft} from '../src/application/story-drafts.js';
import type {StoryDraftRecord, StoryDraftStore, StoryReceiptInsert} from '../src/ports/story-draft-store.js';

const owner = {ownerId: '01994b80-0000-7000-8000-000000000001'};
const id = '01994b80-0000-7000-8000-000000000002';
const commandId = '01994b80-0000-7000-8000-000000000003';
const now = new Date('2026-09-12T00:00:00.000Z');
const settings = {world: '海岛', opening: '一封来信', genre: '日常', playerRole: '旅人', worldRules: ['第一行\n第二行'], tone: '温柔'};

function memoryPort(deleted = false) {
  let record: StoryDraftRecord = {id, title: '草稿', settings, revision: 1, schemaVersion: 1,
    createdAt: now, updatedAt: now, deletedAt: deleted ? now : null, archivedAt: null};
  let receipt: StoryReceiptInsert | null = null;
  let writes = 0;
  const read = {
    findDraft: async () => record,
    listDrafts: async () => [record],
  };
  const store: StoryDraftStore = {
    read: async (_ownerId, work) => work(read),
    write: async (_ownerId, work) => work({
      ...read,
      findReceipt: async () => receipt,
      insertDraft: async input => {writes++; record = input; return record;},
      compareAndSwapDraft: async change => {
        if (change.expectedRevision !== record.revision) return 0;
        writes++;
        record = {...record, ...change.patch, revision: record.revision + 1, updatedAt: change.updatedAt};
        return 1;
      },
      insertReceipt: async input => {receipt = input;},
    }),
  };
  return {store, receipt: () => receipt!, writes: () => writes,
    replaceSettings: (value: unknown) => {record = {...record, settings: value};}};
}

describe('single authoring command namespace and receipt settings', () => {
  it.each(['create', 'update', 'delete', 'restore'] as const)('%s uses authoring.story and canonicalizes both new and replayed receipt settings', async action => {
    const port = memoryPort(action === 'restore');
    const lifecycle = {commandId, id, expectedRevision: 1};
    const invoke = (content = settings) => action === 'create'
      ? createDraft(port.store, owner, {commandId, title: '草稿', settings: content})
      : action === 'update'
      ? updateDraft(port.store, owner, {...lifecycle, patch: {settings: content}})
      : action === 'delete' ? deleteDraft(port.store, owner, lifecycle) : restoreDraft(port.store, owner, lifecycle);
    const first = await invoke();
    expect(port.receipt().commandType).toBe(`authoring.story.${action}.v1`);
    expect(first.data.settings).toEqual(settings);
    expect(Object.keys(first.data.settings)).toEqual(Object.keys(settings));
    expect(port.receipt().response).toEqual(first.data);
    // Simulate JSON property reordering in storage as well as in the retry payload.
    const reordered = {tone: settings.tone, worldRules: settings.worldRules, playerRole: settings.playerRole,
      genre: settings.genre, opening: settings.opening, world: settings.world};
    port.receipt().response.settings = reordered;
    const replay = await invoke(reordered);
    expect(replay).toEqual({...first, replayed: true});
    expect(Object.keys(replay.data.settings)).toEqual(Object.keys(settings));
    expect(port.writes()).toBe(1);
  });

  it('rejects stored premise settings instead of converting a record', async () => {
    const port = memoryPort();
    port.replaceSettings({premise: '旧前提', playerRole: '', worldRules: [], tone: ''});
    await expect(getDraft(port.store, owner, id)).rejects.toThrow('STORED_STORY_INVALID');
  });

  it('rejects premise settings in a receipt instead of replaying converted content', async () => {
    const port = memoryPort();
    const input = {commandId, title: '草稿', settings};
    await createDraft(port.store, owner, input);
    Object.assign(port.receipt().response, {settings: {premise: '旧前提', playerRole: '', worldRules: [], tone: ''}});
    await expect(createDraft(port.store, owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    expect(port.writes()).toBe(1);
  });
});
