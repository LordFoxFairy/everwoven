import {describe, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createCharacter, updateCharacter, deleteCharacter, restoreCharacter, listCharacters} from '../src/application/characters.js';
import type {CharacterStore, CharacterWriteScope, CharacterRecord} from '../src/ports/character-store.js';
import {PrismaCharacterStore} from '../src/infrastructure/db/prisma-character-store.js';
import type {PrismaClient} from '../src/generated/prisma/client.js';
const owner = {ownerId: v7(), datasetId: v7()}, id = v7();
const settings = {personality: '', appearance: '', speakingStyle: '', boundaries: ''};
const command = {datasetId: owner.datasetId, commandId: v7(), name: '角色', settings, portraitAssetId: null};

describe('character boundaries before storage and within write gate', () => {
  it.each(['create', 'update', 'delete', 'restore'] as const)('%s rejects same-owner foreign dataset before any store/receipt access', async action => {
    const findReceipt = vi.fn(), read = vi.fn(), write = vi.fn(async (_owner, work) => work({findReceipt}));
    const store = {read, write} as CharacterStore, trusted = {...owner, datasetId: v7()};
    const life = {datasetId: owner.datasetId, commandId: v7(), id, expectedRevision: 1};
    const call = action === 'create' ? createCharacter(store, trusted, command) : action === 'update' ? updateCharacter(store, trusted, {...life, patch: {name: '角色'}})
      : action === 'delete' ? deleteCharacter(store, trusted, life) : restoreCharacter(store, trusted, life);
    await expect(call).rejects.toThrow('DATASET_CHANGED');
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(findReceipt).not.toHaveBeenCalled();
  });
  it.each(['dataset', 'missingDataset', 'owner', 'q', 'deleted'])('rejects cursor %s mismatch before read', async mismatch => {
    const record: Record<string, unknown> = {version: 1, ownerId: owner.ownerId, datasetId: owner.datasetId, q: '', deleted: 'exclude', updatedAt: new Date().toISOString(), id};
    if (mismatch === 'missingDataset') delete record.datasetId;
    else record[mismatch === 'dataset' ? 'datasetId' : mismatch === 'owner' ? 'ownerId' : mismatch] = mismatch === 'deleted' ? 'only' : v7();
    const read = vi.fn(), store: CharacterStore = {read, write: vi.fn()};
    await expect(listCharacters(store, owner, {cursor: Buffer.from(JSON.stringify(record)).toString('base64url')})).rejects.toThrow('INVALID_CURSOR');
    expect(read).not.toHaveBeenCalled();
  });
  it('performs receipt then CAS then portrait validation and finally inserts a receipt', async () => {
    const steps: string[] = [], now = new Date();
    let record: CharacterRecord = {id, name: '角色', settings, portraitAssetId: v7(), schemaVersion: 1, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null};
    const scope: CharacterWriteScope = {
      findReceipt: async () => {steps.push('receipt'); return null;},
      findCharacter: async () => {steps.push('read'); return record;},
      compareAndSwapCharacter: async change => {steps.push('CAS'); record = {...record, ...change.patch, revision: record.revision + 1, updatedAt: change.updatedAt}; return 1;},
      hasReadyPortrait: async () => {steps.push('portrait'); return true;},
      insertReceipt: async () => {steps.push('insertReceipt');},
      insertCharacter: vi.fn(), listCharacters: vi.fn(), countCharacters: vi.fn(),
    };
    const store: CharacterStore = {read: vi.fn(), write: async (_owner, work) => {steps.push('gate'); return work(scope);}};
    await updateCharacter(store, owner, {datasetId: owner.datasetId, commandId: v7(), id, expectedRevision: 1, patch: {name: '更新'}});
    expect(steps).toEqual(['gate', 'receipt', 'read', 'CAS', 'portrait', 'read', 'insertReceipt']);
  });
  it('the Prisma adapter actually acquires the owner WriteGate before exposing a receipt scope', async () => {
    const steps: string[] = [];
    const tx = {localProfile: {updateMany: vi.fn(async () => {steps.push('gate'); return {count: 1};})},
      commandReceipt: {findUnique: vi.fn(async () => {steps.push('receipt'); return null;})}};
    const db = {$transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx)} as unknown as PrismaClient;
    await new PrismaCharacterStore(db).write(owner.ownerId, scope => scope.findReceipt(command.commandId));
    expect(steps).toEqual(['gate', 'receipt']);
    expect(tx.localProfile.updateMany).toHaveBeenCalledWith({where: {id: owner.ownerId, deletedAt: null}, data: {writeEpoch: {increment: 1}}});
  });
  it('keeps application and transitive pure helpers out of infrastructure/composition/Web', async () => {
    const src = resolve(import.meta.dirname, '../src'), pending = [resolve(src, 'application/characters.ts')], visited = new Set<string>(), errors: string[] = [];
    while (pending.length) {
      const file = pending.pop()!; if (visited.has(file)) continue; visited.add(file);
      for (const match of (await readFile(file, 'utf8')).matchAll(/(?:\bfrom\s*|\bimport\s*|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!;
        if (!specifier.startsWith('.')) {if (!specifier.startsWith('node:') && specifier !== 'uuid') errors.push(specifier); continue;}
        const dependency = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
        if (!['application', 'ports', 'contracts'].some(layer => dependency.startsWith(`${src}/${layer}/`))) errors.push(dependency); else pending.push(dependency);
      }
    }
    expect(errors).toEqual([]);
  });
});
