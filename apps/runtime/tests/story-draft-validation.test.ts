import {describe, expect, it} from 'vitest';
import {parseCreate, parseSettings, parseUpdate} from '../src/contracts/story-draft-validation.js';
import type {StorySettings} from '../src/contracts/story-draft.js';

const empty: StorySettings = {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''};
const keys = ['world', 'opening', 'genre', 'playerRole', 'worldRules', 'tone'] as const;
const limits = [['world', 12000], ['opening', 12000], ['genre', 80], ['playerRole', 4000], ['tone', 500]] as const;
const id = '01994b80-0000-7000-8000-000000000001';

describe('single StorySettings contract', () => {
  it('accepts all six empty fields as an incomplete draft', () => {
    expect(parseSettings(empty)).toEqual(empty);
  });

  it('canonicalizes field order without trimming text or splitting rules', () => {
    const input = {tone: ' 温柔 ', worldRules: ['一条规则\n第二行', ''], playerRole: '旅人', genre: '日常', opening: '来信', world: '海岛'};
    const parsed = parseSettings(input);
    expect(Object.keys(parsed)).toEqual(keys);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.worldRules).not.toBe(input.worldRules);
  });

  it('canonicalizes create and update payloads using the same settings parser', () => {
    const settings = {tone: '', worldRules: [], playerRole: '', genre: '', opening: '', world: ''};
    const create = parseCreate({settings, title: '草稿', commandId: id});
    const update = parseUpdate({patch: {settings, title: '草稿'}, expectedRevision: 1, id, commandId: id});
    expect(Object.keys(create)).toEqual(['commandId', 'title', 'settings']);
    expect(Object.keys(create.settings)).toEqual(keys);
    expect(Object.keys(update)).toEqual(['commandId', 'id', 'expectedRevision', 'patch']);
    expect(Object.keys(update.patch)).toEqual(['title', 'settings']);
    expect(update.patch.settings).toEqual(create.settings);
    expect(Object.keys(update.patch.settings!)).toEqual(keys);
  });

  it.each(keys)('rejects missing %s instead of supplying defaults', key => {
    const input: Record<string, unknown> = {...empty};
    delete input[key];
    expect(() => parseSettings(input)).toThrow('INVALID_STORY_COMMAND');
  });

  describe.each(limits)('%s limit is %i Unicode code points', (key, max) => {
    it('accepts the exact limit', () => {
      const input = {...empty, [key]: '🌊'.repeat(max)};
      expect(parseSettings(input)).toEqual(input);
    });
    it('rejects one code point over the limit', () => {
      expect(() => parseSettings({...empty, [key]: '🌊'.repeat(max + 1)})).toThrow('INVALID_STORY_COMMAND');
    });
    it.each([null, undefined, 1, false, {}, []])('rejects non-string %j', value => {
      expect(() => parseSettings({...empty, [key]: value})).toThrow('INVALID_STORY_COMMAND');
    });
  });

  it('accepts exactly 30 rules of 1000 code points each', () => {
    const input = {...empty, worldRules: Array.from({length: 30}, () => '🌊'.repeat(1000))};
    expect(parseSettings(input)).toEqual(input);
  });

  it.each([
    {name: '31 rules', value: Array(31).fill('')},
    {name: '1001 code points', value: ['🌊'.repeat(1001)]},
    {name: 'null', value: null},
    {name: 'string', value: 'rule'},
    {name: 'object', value: {}},
    {name: 'number element', value: [1]},
    {name: 'null element', value: [null]},
    {name: 'sparse array', value: new Array(1)},
  ])('rejects worldRules: $name', ({value}) => {
    expect(() => parseSettings({...empty, worldRules: value})).toThrow('INVALID_STORY_COMMAND');
  });

  it.each([
    {name: 'old premise-only settings', value: {premise: '旧前提', playerRole: '', worldRules: [], tone: ''}},
    {name: 'premise alongside all new fields', value: {...empty, premise: '旧前提'}},
    {name: 'unknown field', value: {...empty, extra: ''}},
    {name: 'null', value: null},
    {name: 'array', value: []},
    {name: 'string', value: 'settings'},
    {name: 'inherited fields', value: Object.create(empty)},
  ])('rejects $name with no conversion', ({value}) => {
    expect(() => parseSettings(value)).toThrow('INVALID_STORY_COMMAND');
  });
});
