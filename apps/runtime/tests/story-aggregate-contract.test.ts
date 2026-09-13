import {expect, it} from 'vitest';
import * as v from '../src/contracts/story-draft-validation.js';
const id = '01994b80-0000-7000-8000-000000000001',
  datasetId = '01994b80-0000-7000-8000-000000000002';
const settings = {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''};
const assetSlots = {cover: null, opening: null, character: null};
const root = {protocolVersion: 1, datasetId, commandId: id, title: 'story', settings, mainCharacter: null, assetSlots};
it('accepts the single aggregate create and canonicalizes all fields', () => {
  expect(v.parseCreate(root)).toEqual(root);
  expect(Object.keys(v.parseCreate(root))).toEqual(Object.keys(root));
});
it.each([undefined, 0, 2, '1', null])(
  'missing/wrong protocol %s requires reload rather than compatibility',
  (protocolVersion) => {
    expect(() => v.parseCreate({...root, protocolVersion})).toThrow('CLIENT_RELOAD_REQUIRED');
  },
);
it.each(['mainCharacter', 'assetSlots', 'datasetId'])('requires explicit creation field %s', (key) => {
  const input = {...root} as Record<string, unknown>;
  delete input[key];
  expect(() => v.parseCreate(input)).toThrow('INVALID_STORY_COMMAND');
});
it('parses get/list with protocol and rejects old optional whole-list input', () => {
  expect(v.parseGet({protocolVersion: 1, datasetId, id})).toMatchObject({id, includeDeleted: false});
  expect(v.parseList({protocolVersion: 1, datasetId})).toMatchObject({limit: 20, q: '', deleted: 'exclude'});
  expect(() => v.parseList(undefined)).toThrow('CLIENT_RELOAD_REQUIRED');
});
it('rejects bound on create and accepts a strict bound update', () => {
  const mainCharacter = {
    kind: 'bound',
    characterVersionId: id,
    overrides: {portrait: {mode: 'inherit'}, relationship: ''},
  };
  expect(() => v.parseCreate({...root, mainCharacter})).toThrow('INVALID_STORY_COMMAND');
  expect(
    v.parseUpdate({protocolVersion: 1, datasetId, commandId: id, id, expectedRevision: 1, patch: {mainCharacter}}),
  ).toMatchObject({patch: {mainCharacter}});
});
it.each([{cover: null, opening: null}, {...assetSlots, other: null}, null])(
  'assetSlots is complete when present %j',
  (slots) => {
    expect(() => v.parseCreate({...root, assetSlots: slots})).toThrow('INVALID_STORY_COMMAND');
  },
);
it('portrait contradiction in create is rejected, nullable role permits an empty draft', () => {
  expect(() => v.parseCreate({...root, assetSlots: {...assetSlots, character: id}})).toThrow('INVALID_STORY_COMMAND');
});
it('allows empty explicit text overrides without inheriting or trimming', () => {
  const mainCharacter = {
    kind: 'library',
    templateId: id,
    expectedTemplateRevision: 1,
    overrides: {portrait: {mode: 'none'}, relationship: '', name: '', settings: {personality: ''}},
  };
  expect(v.parseCreate({...root, mainCharacter})).toMatchObject({mainCharacter});
});
it('counts Unicode code points for inline fields and rejects explicit undefined overrides', () => {
  const mainCharacter = {
    kind: 'inline',
    name: '😀'.repeat(120),
    settings: {personality: '', appearance: '', speakingStyle: '', boundaries: ''},
    portraitAssetId: null,
    overrides: {portrait: {mode: 'none'}, relationship: ''},
  };
  expect(v.parseCreate({...root, mainCharacter})).toMatchObject({mainCharacter});
  expect(() => v.parseCreate({...root, mainCharacter: {...mainCharacter, name: '😀'.repeat(121)}})).toThrow(
    'INVALID_STORY_COMMAND',
  );
  expect(() =>
    v.parseCreate({
      ...root,
      mainCharacter: {...mainCharacter, overrides: {...mainCharacter.overrides, name: undefined}},
    }),
  ).toThrow('INVALID_STORY_COMMAND');
});
it('bounds maximum raw and escaped Unicode requests under the declared 2MiB budget', () => {
  const s = {
    world: '😀'.repeat(12000),
    opening: '😀'.repeat(12000),
    genre: '😀'.repeat(80),
    playerRole: '😀'.repeat(4000),
    worldRules: Array.from({length: 30}, () => '😀'.repeat(1000)),
    tone: '😀'.repeat(500),
  };
  const cs = {
    personality: '😀'.repeat(8000),
    appearance: '😀'.repeat(4000),
    speakingStyle: '😀'.repeat(2000),
    boundaries: '😀'.repeat(4000),
  };
  const x = v.parseCreate({
    ...root,
    title: '😀'.repeat(120),
    settings: s,
    mainCharacter: {
      kind: 'inline',
      name: '😀'.repeat(120),
      settings: cs,
      portraitAssetId: null,
      overrides: {portrait: {mode: 'none'}, name: '😀'.repeat(120), relationship: '😀'.repeat(4000), settings: cs},
    },
  });
  const json = JSON.stringify(x);
  expect(Buffer.byteLength(json)).toBeGreaterThan(262144);
  expect(Buffer.byteLength(json.replace(/😀/gu, '\\ud83d\\ude00'))).toBeLessThan(2097152);
});
it('strict output parsers validate the full aggregate, reject omitted relations and contradictory effective fields', async () => {
  const out = await import('../src/contracts/story-draft-output.js');
  const data = {
    protocolVersion: 1,
    datasetId,
    id,
    title: 'story',
    settings,
    mainCharacter: null,
    assetSlots,
    assets: [],
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  };
  expect(out.parseDraftDTO(data)).toEqual(data);
  expect(out.parseDraftCommandResult({data, replayed: true})).toEqual({data, replayed: true});
  expect(() => out.parseDraftDTO({...data, mainCharacter: undefined})).toThrow('INVALID_STORY_DTO');
  expect(() => out.parseDraftDTO({...data, assets: [{state: 'missing', id, datasetId}]})).toThrow('INVALID_STORY_DTO');
  const version = {
    id,
    characterTemplateId: id,
    versionNo: 1,
    sourceRevision: 1,
    name: 'name',
    settings: {personality: '', appearance: '', speakingStyle: '', boundaries: ''},
    portraitAssetId: null,
    schemaVersion: 1,
    createdAt: data.createdAt,
  };
  const overrides = {portrait: {mode: 'none'}, relationship: ''};
  expect(() =>
    out.parseDraftDTO({
      ...data,
      mainCharacter: {
        version,
        overrides,
        effective: {name: 'WRONG', settings: version.settings, relationship: '', portraitAssetId: null},
      },
    }),
  ).toThrow('INVALID_STORY_DTO');
});
it('rejects sparse response arrays instead of accepting holes as verified assets or summaries', async () => {
  const out = await import('../src/contracts/story-draft-output.js');
  const data = {
    protocolVersion: 1,
    datasetId,
    id,
    title: 'story',
    settings,
    mainCharacter: null,
    assetSlots: {...assetSlots, cover: id},
    assets: new Array(1),
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  };
  expect(() => out.parseDraftDTO(data)).toThrow('INVALID_STORY_DTO');
  expect(() =>
    out.parseDraftPage({protocolVersion: 1, datasetId, items: new Array(1), totalMatching: 1, nextCursor: null}),
  ).toThrow('INVALID_STORY_DTO');
});
it.each(['\u0000', '😀'])(
  'maximum legal Unicode %j and escaped JSON roundtrip fit the public byte bound',
  async (char) => {
    const {STORY_MUTATION_MAX_BYTES} = await import('../src/contracts/story-draft.js');
    const text = (n: number) => char.repeat(n),
      cs = {personality: text(8000), appearance: text(4000), speakingStyle: text(2000), boundaries: text(4000)};
    const input = v.parseCreate({
      ...root,
      title: char === '\u0000' ? 'T'.repeat(120) : text(120),
      settings: {
        world: text(12000),
        opening: text(12000),
        genre: text(80),
        playerRole: text(4000),
        worldRules: Array.from({length: 30}, () => text(1000)),
        tone: text(500),
      },
      mainCharacter: {
        kind: 'inline',
        name: char === '\u0000' ? 'N'.repeat(120) : text(120),
        settings: cs,
        portraitAssetId: null,
        overrides: {portrait: {mode: 'none'}, name: text(120), settings: cs, relationship: text(4000)},
      },
    });
    const raw = JSON.stringify(input),
      escaped = raw.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    expect(Buffer.byteLength(raw)).toBeLessThan(STORY_MUTATION_MAX_BYTES);
    expect(Buffer.byteLength(escaped)).toBeLessThan(STORY_MUTATION_MAX_BYTES);
    expect(v.parseCreate(JSON.parse(escaped))).toEqual(input);
  },
);
