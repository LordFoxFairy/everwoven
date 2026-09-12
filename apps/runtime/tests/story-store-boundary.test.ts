import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, expectTypeOf, it} from 'vitest';
import {createDraft, getDraft, updateDraft} from '../src/application/story-drafts.js';
import type {StoryDraftRecord, StoryDraftStore, StoryReceiptRecord} from '../src/ports/story-draft-store.js';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

// Covers static imports/re-exports, dynamic imports, import types and require.
// Resolve relative edges as well so a local barrel cannot hide a forbidden layer.
function imports(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1]!);
}

describe('story store dependency direction', () => {
  it('keeps application and ports independent of Prisma, infrastructure, composition and Web, including transitive imports', async () => {
    const pending = [resolve(src, 'application/story-drafts.ts')];
    const visited = new Set<string>();
    const violations: string[] = [];
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of imports(await readFile(file, 'utf8'))) {
        if (!specifier.startsWith('.')) {
          if (!specifier.startsWith('node:') && specifier !== 'uuid') violations.push(`${file}: ${specifier}`);
          continue;
        }
        const dependency = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
        if (!['application', 'ports', 'contracts'].some(layer => dependency.startsWith(`${src}/${layer}/`))) {
          violations.push(`${file}: ${specifier}`);
        } else pending.push(dependency);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('application accepts the port without database types', () => {
  const owner = {ownerId: '01993ce0-0000-7000-8000-000000000001'};
  const id = '01993ce0-0000-7000-8000-000000000002';
  const settings = {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''};

  it('maps a port record to the DTO and keeps stored JSON unknown at the type boundary', async () => {
    expectTypeOf<StoryDraftRecord['settings']>().toEqualTypeOf<unknown>();
    expectTypeOf<StoryReceiptRecord['response']>().toEqualTypeOf<unknown>();
    const now = new Date('2026-09-12T00:00:00.000Z');
    const record: StoryDraftRecord = {id, title: '端口读取', settings, revision: 1, schemaVersion: 1,
      createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null};
    const store: StoryDraftStore = {
      read: async (ownerId, work) => {
        expect(ownerId).toBe(owner.ownerId);
        return work({findDraft: async (storyId, includeDeleted) => {
          expect(storyId).toBe(id); expect(includeDeleted).toBe(false); return record;
        }, listDrafts: async () => {throw new Error('unexpected list');}});
      },
      write: async () => {throw new Error('unexpected write');},
    };
    expect(await getDraft(store, owner, id)).toEqual({...record, createdAt: now.toISOString(), updatedAt: now.toISOString()});
  });

  it('rejects invalid commands before opening a store transaction', async () => {
    let calls = 0;
    const unexpected = async () => {calls++; throw new Error('unexpected transaction');};
    const store: StoryDraftStore = {read: unexpected, write: unexpected};
    await expect(createDraft(store, owner, {commandId: id, title: ' ', settings})).rejects.toThrow('INVALID_STORY_COMMAND');
    await expect(updateDraft(store, owner, {commandId: id, id, expectedRevision: 1, patch: {}})).rejects.toThrow('INVALID_STORY_COMMAND');
    expect(calls).toBe(0);
  });
});
