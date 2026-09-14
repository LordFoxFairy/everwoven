import {expect, it} from 'vitest';
import {parsePlayDTO, parsePlaybackResult, parseSceneResult} from '../src/contracts/generation-output.js';
import {parseGetPlay, parseCompletePlayback} from '../src/contracts/generation.js';
const id = '01994b80-0000-7000-8000-000000000001';
const scene = {summary: '雨停了。', choices: [{id: 'ask', title: '问问他', text: '出去走走吗？'}, {id: 'look', title: '看窗外', text: '我看向窗外。'}]};
const dto = {protocolVersion: 1, datasetId: id, experienceId: id, title: '雨后', revision: 2, status: 'playing',
  turn: {id, status: 'ready', media: {id, duration: 5}, errorCode: null}, interaction: null};
it('accepts the persisted lifecycle, never early choices or a media URL', () => {
  expect(parsePlayDTO(dto)).toEqual(dto);
  expect(parsePlayDTO({...dto, status: 'preparing', turn: null}).turn).toBeNull();
  for (const status of ['queued', 'planning', 'prepared', 'submitting', 'polling', 'materializing', 'checking', 'validating'])
    expect(parsePlayDTO({...dto, status: 'generating', turn: {...dto.turn, status, media: null}}).interaction).toBeNull();
  for (const status of ['unknown', 'failed']) expect(parsePlayDTO({...dto, status, turn: {...dto.turn, status, media: null}}).status).toBe(status);
  expect(parsePlayDTO({...dto, status: 'awaiting', turn: {...dto.turn, status: 'viewed'}, interaction: {id, ...scene}}).interaction?.choices).toHaveLength(2);
  for (const patch of [{interaction: {id, ...scene}}, {turn: {...dto.turn, media: null}}, {status: 'preparing'},
    {turn: {...dto.turn, media: {...dto.turn.media, url: 'https://secret.invalid'}}}, {turn: {...dto.turn, errorCode: 'raw supplier error'}}])
    expect(() => parsePlayDTO({...dto, ...patch})).toThrow('INVALID_GENERATION_DTO');
});
it('rejects malformed/oversized/duplicate suggestions and unknown fields', () => {
  for (const value of [{...scene, choices: []}, {...scene, choices: [scene.choices[0], scene.choices[0]]},
    {...scene, summary: 'x'.repeat(2001)}, {...scene, privatePath: '/private'}, {...scene, choices: [null, null]},
    {...scene, choices: [{...scene.choices[0], command: 'execute'}, scene.choices[1]]}])
    expect(() => parseSceneResult(value)).toThrow('INVALID_GENERATION_DTO');
});
it('correlates historical receipt to the exact completed media/revision', () => {
  const input = parseCompletePlayback({protocolVersion: 1, datasetId: id, experienceId: id, expectedExperienceRevision: 1, commandId: id, turnId: id, mediaId: id});
  const receipt = {data: {...dto, status: 'awaiting', turn: {...dto.turn, status: 'viewed'}, interaction: {id, ...scene}}, replayed: true};
  expect(parsePlaybackResult(receipt, input)).toEqual(receipt);
  expect(() => parsePlaybackResult(receipt, {...input, expectedExperienceRevision: 2})).toThrow('INVALID_GENERATION_DTO');
});
it('normalizes malformed dataset IDs to this domain while preserving protocol upgrade errors', () => {
  expect(() => parseGetPlay({protocolVersion: 1, datasetId: 'bad', experienceId: id})).toThrow('INVALID_GENERATION_QUERY');
  expect(() => parseCompletePlayback({protocolVersion: 1, datasetId: 'bad'})).toThrow('INVALID_GENERATION_COMMAND');
  expect(() => parseGetPlay({protocolVersion: 2})).toThrow('CLIENT_RELOAD_REQUIRED');
});
