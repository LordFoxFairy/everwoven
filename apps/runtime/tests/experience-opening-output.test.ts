import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from './fixtures/story-aggregate/setup.js';
import {binding} from './fixtures/provider-binding.js';
import {createExperienceOpeningService} from '../src/composition/experience-opening-service.js';
import {parseExperienceOpeningDTO, parseExperienceOpeningResult, parseBindingDirectory} from '../src/contracts/experience-opening-output.js';
import type {ExperienceOpeningDTO} from '../src/contracts/experience-opening.js';
beforeAll(prepare); afterAll(dispose);
let dto: ExperienceOpeningDTO;
beforeAll(async () => {
  const f = await fixture();
  try {
    const source = await f.service.create(f.owner, f.create());
    const service = createExperienceOpeningService(f.db, {resolve: () => binding(f.owner.ownerId)});
    dto = (await service.create(f.owner, {...f.protocol, commandId: v7(), storyDraftId: source.data.id, expectedStoryRevision: 1,
      bindingKey: 'video-primary', expectedBindingVersion: 1, budget: {limitMicros: '9223372036854775807', currency: 'USD'}})).data;
  } finally { await f.close(); }
});
describe('opening public output boundary', () => {
  it('accepts actual persisted opening and returns detached canonical fields', () => {
    expect(parseExperienceOpeningDTO(dto)).toEqual(dto);
    const output = parseExperienceOpeningResult({data: dto, replayed: true});
    output.data.story.title = 'changed';
    expect(dto.story.title).not.toBe('changed');
    expect(parseExperienceOpeningResult({data: dto, replayed: false})).toEqual({data: dto, replayed: false});
  });
  it.each(['extra', 'secret', 'status', 'dispatch', 'source-dataset', 'setup-experience', 'draft-node', 'draft-experience', 'draft-text', 'time', 'budget', 'hash', 'option'])(
    'rejects invalid output %s', kind => {
      const v = structuredClone(dto);
      if (kind === 'extra') Object.assign(v, {ownerId: v7()});
      if (kind === 'secret') Object.assign(v.binding, {credentialRef: 'env:KEY'});
      if (kind === 'status') Object.assign(v, {status: 'playing'});
      if (kind === 'dispatch') Object.assign(v, {canDispatch: true});
      if (kind === 'source-dataset') v.story.datasetId = v7();
      if (kind === 'setup-experience') v.setup.experienceId = v7();
      if (kind === 'draft-node') v.responseDraft.interactionEventId = v7();
      if (kind === 'draft-experience') v.responseDraft.experienceId = v7();
      if (kind === 'draft-text') Object.assign(v.responseDraft, {text: 'later'});
      if (kind === 'time') v.createdAt = '2000-01-01T00:00:00.000Z';
      if (kind === 'budget') v.budget.limitMicros = '01';
      if (kind === 'hash') v.binding.snapshotHash = 'not-hash';
      if (kind === 'option') Object.assign(v.setup, {options: ['go']});
      expect(() => parseExperienceOpeningDTO(v)).toThrow('INVALID_EXPERIENCE_DTO');
    },
  );
  it('rejects extra wrapper fields and nonboolean replay flags', () => {
    expect(() => parseExperienceOpeningResult({data: dto, replayed: 'true'})).toThrow('INVALID_EXPERIENCE_DTO');
    expect(() => parseExperienceOpeningResult({data: dto, replayed: true, key: 'hidden'})).toThrow('INVALID_EXPERIENCE_DTO');
  });
});
describe('authenticated binding directory output', () => {
  const choice = () => ({bindingKey: 'video', versionNo: 1, providerId: 'minimax', modelId: 'MiniMax-H3-Max', catalogId: 'minimax-h3-max',
    connectionId: 'personal', region: 'cn', mode: 'job', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'},
    canPrepare: true, canDispatch: false, accountVerification: 'unknown'});
  it.each(['empty', 'unavailable', 'not_initialized'] as const)('preserves explicit %s without choices', status => {
    const v = {protocolVersion: 1, datasetId: v7(), status, items: []}; expect(parseBindingDirectory(v)).toEqual(v);
    expect(() => parseBindingDirectory({...v, items: [choice()]})).toThrow('INVALID_EXPERIENCE_DTO');
  });
  it('accepts ready public choices but rejects false readiness and sensitive fields', () => {
    const v = {protocolVersion: 1, datasetId: v7(), status: 'ready', items: [choice()]};
    expect(parseBindingDirectory(v)).toEqual(v);
    for (const bad of [{...choice(), credentialRef: 'env:KEY'}, {...choice(), canDispatch: true}, {...choice(), accountVerification: 'verified'}, {...choice(), generation: {baseUrl: 'https://wrong.invalid'}}])
      expect(() => parseBindingDirectory({...v, items: [bad]})).toThrow('INVALID_EXPERIENCE_DTO');
    expect(() => parseBindingDirectory({...v, items: []})).toThrow('INVALID_EXPERIENCE_DTO');
    expect(() => parseBindingDirectory({...v, items: [choice(), choice()]})).toThrow('INVALID_EXPERIENCE_DTO');
  });
  it('rejects unregistered regions and impossible model/generation combinations', () => {
    for (const bad of [{...choice(), region: 'unregistered-region'}, {...choice(), generation: {duration: 3600, resolution: '2K', ratio: 'adaptive'}}])
      expect(() => parseBindingDirectory({protocolVersion: 1, datasetId: v7(), status: 'ready', items: [bad]})).toThrow('INVALID_EXPERIENCE_DTO');
  });
});
