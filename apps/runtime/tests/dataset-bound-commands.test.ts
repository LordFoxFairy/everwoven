import {emptyRead, emptyWrite} from './fixtures/story-aggregate/empty-port.js';
import {describe, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {isBusinessId} from '../src/contracts/primitives.js';
import {createDraft, updateDraft, deleteDraft, restoreDraft, listDrafts} from '../src/application/story-drafts.js';
import {parseCreate, parseUpdate, parseLifecycle} from '../src/contracts/story-draft-validation.js';
import type {StoryDraftRecord, StoryReceiptInsert, StoryDraftStore} from '../src/ports/story-draft-store.js';

const datasetId = v7(), ownerId = v7(), id = v7(), commandId = v7();
const nonV7DatasetId = '01994b80-7000-4000-8000-000000000001';
const settings = {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''};
const commands = {
  create: {protocolVersion: 1 as const, datasetId, commandId, title: '保留文本', mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}, settings},
  update: {protocolVersion: 1 as const, datasetId, commandId, id, expectedRevision: 1, patch: {title: '保留文本'}},
  delete: {protocolVersion: 1 as const, datasetId, commandId, id, expectedRevision: 1},
  restore: {protocolVersion: 1 as const, datasetId, commandId, id, expectedRevision: 1},
};
function boundary() {
  const findReceipt = vi.fn();
  const write = vi.fn(async (_owner, work) => work({findReceipt}));
  const read = vi.fn();
  return {store: {write, read} as StoryDraftStore, write, read, findReceipt};
}
describe('dataset command boundary', () => {
  it('uses an explicitly non-v7 invalid dataset fixture', () => {
    expect(isBusinessId(nonV7DatasetId)).toBe(false);
  });
  it.each(['create', 'update', 'delete', 'restore'] as const)('%s rejects same owner / different dataset before entering store or reading a receipt', async action => {
    const b = boundary(), owner = {ownerId, datasetId: v7()};
    const invoke = () => action === 'create' ? createDraft(b.store, owner, commands.create)
      : action === 'update' ? updateDraft(b.store, owner, commands.update)
      : action === 'delete' ? deleteDraft(b.store, owner, commands.delete) : restoreDraft(b.store, owner, commands.restore);
    await expect(invoke()).rejects.toThrow('DATASET_CHANGED');
    expect(b.write).not.toHaveBeenCalled(); expect(b.findReceipt).not.toHaveBeenCalled(); expect(b.read).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '', 'bad', nonV7DatasetId])('rejects missing or invalid command dataset %s', value => {
    for (const [parse, input] of [[parseCreate, commands.create], [parseUpdate, commands.update], [parseLifecycle, commands.delete]] as const) {
      const raw = {...input, datasetId: value}; if (value === undefined) delete raw.datasetId;
      expect(() => parse(raw as never)).toThrow('INVALID_STORY_COMMAND');
    }
  });
  it.each(['other', 'missing'])('rejects %s dataset cursor before store.read', async mode => {
    const b = boundary();
    const cursor = Buffer.from(JSON.stringify({version: 1, ownerId, ...(mode === 'other' ? {datasetId: v7()} : {}),
      deleted: 'exclude', updatedAt: new Date().toISOString(), id})).toString('base64url');
    await expect(listDrafts(b.store, {ownerId, datasetId}, {protocolVersion: 1, datasetId, cursor})).rejects.toThrow('INVALID_CURSOR');
    expect(b.read).not.toHaveBeenCalled();
  });
  it('emits a dataset-scoped cursor and permits only that dataset to read the next page', async () => {
    const now = new Date(), record: StoryDraftRecord = {id, title: '草稿', settings, revision: 1, schemaVersion: 1,
      createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null};
    const list = vi.fn().mockResolvedValue([{...record, genre: settings.genre, mainCharacterName: null, coverAssetId: null}, {...record, genre: settings.genre, mainCharacterName: null, coverAssetId: null, id: v7()}]);
    const read: StoryDraftStore['read'] = vi.fn(async (_owner, work) => work({...emptyRead, findDraft: async () => record, listDrafts: list, countDrafts: async () => 2}));
    const store: StoryDraftStore = {read, write: vi.fn()};
    const page = await listDrafts(store, {ownerId, datasetId}, {protocolVersion: 1, datasetId, limit: 1});
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toMatchObject({protocolVersion: 1, datasetId, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/)});
    await listDrafts(store, {ownerId, datasetId}, {protocolVersion: 1, datasetId, cursor: page.nextCursor!});
    expect(read).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]![0].before).toEqual({updatedAt: now, id});
    const otherDataset = v7();
    await expect(listDrafts(store, {ownerId, datasetId: otherDataset}, {protocolVersion: 1, datasetId: otherDataset, cursor: page.nextCursor!})).rejects.toThrow('INVALID_CURSOR');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('includes dataset in canonical receipt hashes for identical owner, command and content', async () => {
    const receipts: StoryReceiptInsert[] = [];
    let record: StoryDraftRecord;
    const store: StoryDraftStore = {read: vi.fn(), write: async (_owner, work) => work({...emptyWrite,
      findReceipt: async () => null, insertDraft: async input => {record = input; return input;},
      findDraft: async () => record, listDrafts: vi.fn(), compareAndSwapDraft: vi.fn(),
      insertReceipt: async input => {receipts.push(input);},
    })};
    await createDraft(store, {ownerId, datasetId}, commands.create);
    const other = v7();
    await createDraft(store, {ownerId, datasetId: other}, {...commands.create, datasetId: other});
    expect(receipts[0]!.commandId).toBe(receipts[1]!.commandId);
    expect(receipts[0]!.payloadHash).not.toBe(receipts[1]!.payloadHash);
  });

});
