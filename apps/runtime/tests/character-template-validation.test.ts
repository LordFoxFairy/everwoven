import {describe, expect, it} from 'vitest';
import {v7} from 'uuid';
const settings = {personality: '', appearance: '', speakingStyle: '', boundaries: ''};
const command = {datasetId: v7(), commandId: v7(), name: '角色', settings, portraitAssetId: null};
async function parsers() {
  const module = await import('../src/contracts/character-template-validation.js').catch(() => null);
  expect(module, 'character parsers must exist').not.toBeNull(); return module!;
}
describe('strict CharacterTemplate contracts', () => {
  it('accepts empty settings and canonicalizes name/settings/portrait without trimming user text', async () => {
    const p = await parsers();
    const input = {...command, name: '  😀角色  ', settings: {boundaries: '', speakingStyle: '', appearance: '', personality: ''}};
    const parsed = p.parseCreate(input);
    expect(parsed).toEqual(input); expect(Object.keys(parsed.settings)).toEqual(Object.keys(settings));
    expect(Object.keys(parsed)).toEqual(['datasetId', 'commandId', 'name', 'settings', 'portraitAssetId']);
    expect(p.parseUpdate({datasetId: command.datasetId, commandId: v7(), id: v7(), expectedRevision: 1, patch: {portraitAssetId: null}}).patch).toEqual({portraitAssetId: null});
  });
  it.each([['personality', 8000], ['appearance', 4000], ['speakingStyle', 2000], ['boundaries', 4000]] as const)('enforces %s Unicode boundary %s', async (key, max) => {
    const p = await parsers();
    expect(p.parseSettings({...settings, [key]: '😀'.repeat(max)})[key]).toBe('😀'.repeat(max));
    expect(() => p.parseSettings({...settings, [key]: '😀'.repeat(max + 1)})).toThrow('INVALID_CHARACTER_COMMAND');
    for (const value of [null, undefined, 1, [], {}]) expect(() => p.parseSettings({...settings, [key]: value})).toThrow('INVALID_CHARACTER_COMMAND');
    const missing: Record<string, unknown> = {...settings}; delete missing[key];
    expect(() => p.parseSettings(missing)).toThrow('INVALID_CHARACTER_COMMAND');
  });
  it.each(['', ' ', '😀'.repeat(121), null, undefined, 1])('rejects invalid name %j', async name => {
    const p = await parsers(); expect(() => p.parseName(name)).toThrow('INVALID_CHARACTER_COMMAND');
    expect(p.parseName('😀'.repeat(120))).toBe('😀'.repeat(120));
  });
  it.each(['scope', 'ownerId', 'createdAt', 'updatedAt', 'deletedAt', 'archivedAt', 'revision', 'id', 'sourceStoryDraftId'])('rejects client %s on create and patch', async key => {
    const p = await parsers();
    expect(() => p.parseCreate({...command, [key]: v7()} as never)).toThrow('INVALID_CHARACTER_COMMAND');
    expect(() => p.parseUpdate({datasetId: command.datasetId, commandId: v7(), id: v7(), expectedRevision: 1, patch: {[key]: v7()}} as never)).toThrow('INVALID_CHARACTER_COMMAND');
  });
  it.each([undefined, null, 'bad', v7().replace('-7', '-4')])('rejects malformed or missing dataset for every command %j', async datasetId => {
    const p = await parsers(), lifecycle = {datasetId, commandId: v7(), id: v7(), expectedRevision: 1};
    expect(() => p.parseCreate({...command, datasetId} as never)).toThrow('INVALID_CHARACTER_COMMAND');
    expect(() => p.parseUpdate({...lifecycle, patch: {name: '角色'}} as never)).toThrow('INVALID_CHARACTER_COMMAND');
    expect(() => p.parseLifecycle(lifecycle as never)).toThrow('INVALID_CHARACTER_COMMAND');
  });
  it.each([undefined, '', 'demo-id', [], 1])('rejects non-null invalid portrait %j', async portraitAssetId => {
    const p = await parsers(); expect(() => p.parseCreate({...command, portraitAssetId} as never)).toThrow('INVALID_CHARACTER_COMMAND');
  });
  it('requires complete settings and nonempty patch and strict lifecycle command', async () => {
    const p = await parsers(), lifecycle = {datasetId: command.datasetId, commandId: v7(), id: v7(), expectedRevision: 1};
    for (const patch of [{}, {settings: {personality: ''}}, {settings: {...settings, name: 'duplicate'}}, {settings: []}]) {
      expect(() => p.parseUpdate({...lifecycle, patch} as never)).toThrow('INVALID_CHARACTER_COMMAND');
    }
    expect(() => p.parseLifecycle({...lifecycle, name: 'hidden'} as never)).toThrow('INVALID_CHARACTER_COMMAND');
    for (const expectedRevision of [0, -1, 1.5, '1', 2147483648]) expect(() => p.parseLifecycle({...lifecycle, expectedRevision} as never)).toThrow('INVALID_CHARACTER_COMMAND');
    expect(p.parseLifecycle({...lifecycle, expectedRevision: 2147483647}).expectedRevision).toBe(2147483647);
  });
  it('strictly validates list filters without silently changing q', async () => {
    const p = await parsers(); expect(p.parseList({q: ' %_角色 ', limit: 100, deleted: 'only'})).toEqual({q: ' %_角色 ', limit: 100, deleted: 'only'});
    expect(p.parseList({})).toEqual({q: '', limit: 20, deleted: 'exclude'});
    for (const input of [null, [], {q: '😀'.repeat(121)}, {q: null}, {q: undefined}, {limit: 0}, {limit: 101}, {limit: 1.5}, {deleted: 'all'}, {cursor: null}, {scope: 'story'}, {ownerId: v7()}]) {
      expect(() => p.parseList(input as never)).toThrow('INVALID_CHARACTER_QUERY');
    }
  });
});
