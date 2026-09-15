import {describe, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {createVideoBindingRegistry} from '../src/application/video-binding-registry.js';
import {createPolloVideoJobs} from '../src/providers/pollo-jobs.js';
import {parseVideoJobSnapshot} from '../src/contracts/video-job-output.js';
import {parseBindingDirectory} from '../src/contracts/experience-opening-output.js';
const input = {prompt: '一位成年朋友坐在窗边，抬头微笑。', duration: 5, resolution: '480P', ratio: '16:9'};
const json = (body: unknown) => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json; charset=utf-8'}});
function config(region = 'test') {
 return {schemaVersion: 1, connections: [{id: 'personal-pollo', providerId: 'pollo', region, accountScopeId: 'personal', credentialRef: 'env:POLLO_API_KEY'}],
  bindings: [{bindingKey: 'video-pollo', versionNo: 1, connectionId: 'personal-pollo', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '480P', ratio: '16:9'}}]};
}
function setup(region = 'test') {
 const registry = createVideoBindingRegistry(config(region));
 const spec = {...registry.resolve({ownerId: v7(), datasetId: v7()}, {bindingKey: 'video-pollo', versionNo: 1}), id: v7(), createdAt: new Date()};
 const fetchImpl = vi.fn<typeof fetch>();
 const dependencies = {apiKey: 'TEST_KEY', basicAuth: 'Basic dGVzdDp0ZXN0', fetchImpl};
 return {registry, spec, dependencies, fetchImpl, jobs: createPolloVideoJobs(spec, dependencies), operation: v7()};
}
describe('Pollo internal platform adapter', () => {
 it('uses the local general_agent protocol and H3 Max native schema, one unpublished output', async () => {
  const f = setup(); f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id: 'task-1'}}));
  const ref = await f.jobs.submit(f.operation, f.jobs.prepare({prompt: input.prompt}));
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  const [url, options] = f.fetchImpl.mock.calls[0]!;
  expect(url).toBe('https://test123.pollo.ai/api/platform/generation/text2video');
  expect(options).toMatchObject({method: 'POST', redirect: 'manual', headers: {'x-api-key': 'TEST_KEY', Authorization: 'Basic dGVzdDp0ZXN0'}});
  expect(JSON.parse(options!.body as string)).toEqual({generationInput: {videoModel: 'minimax-hailuo-03-max', prompt: input.prompt,
   resolution: '480P', length: 5, aspectRatio: '16:9', numOutputs: 1, published: false, protectionMode: true,
   enableMagicPrompt: false, enableTranslatePrompt: false}, sort: 0});
  expect(ref).toMatchObject({providerId: 'pollo', modelId: 'minimax-hailuo-03-max', taskId: 'task-1', operationId: f.operation, region: 'test'});
  expect(JSON.stringify(f.registry.list())).not.toMatch(/credentialRef|env:|accountScopeId|https:/);
 });
 it.each([4, 16, 5.5])('rejects invalid duration %s before any request', duration => {
  const c = config(); c.bindings[0]!.generation.duration = duration;
  expect(() => createVideoBindingRegistry(c)).toThrow('INVALID_VIDEO_REGISTRY');
 });
 it.each(['2K', '480p', '1080P'])('rejects invalid native resolution %s', resolution => {
  const c = config(); c.bindings[0]!.generation.resolution = resolution;
  expect(() => createVideoBindingRegistry(c)).toThrow('INVALID_VIDEO_REGISTRY');
 });
 it('rejects public alias, public protocol, altered endpoint/capabilities, images and hidden model overrides', async () => {
  const f = setup();
  for (const change of [{modelId: 'minimax-h3-max'}, {providerId: 'minimax'}, {adapterVersion: 'v1'},
   {parameters: {...f.spec.parameters, protocolVersion: 'v1'}}, {parameters: {...f.spec.parameters, endpointProfileId: 'arbitrary'}}, {capabilities: {schemaVersion: 1}}]) {
   expect(() => createPolloVideoJobs({...f.spec, ...change}, f.dependencies)).toThrow();
  }
  for (const change of [{duration: 10}, {ratio: '9:16'}, {frames: {first: 'https://example.com/a.png'}}, {model: 'other'}, {prompt: 'a'.repeat(7001)}]) {
   await expect(f.jobs.submit(f.operation, {...input, ...change})).rejects.toThrow();
  }
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it.each([302, 307, 400, 401, 403, 429, 500, 503])('never follows or retries HTTP %s', async status => {
  const f = setup(); f.fetchImpl.mockResolvedValue(new Response(null, {status, headers: {location: 'https://accounts.feishu.cn/login'}}));
  await expect(f.jobs.submit(f.operation, input)).rejects.toMatchObject({code: 'submission-unknown', submission: 'unknown', httpStatus: status});
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('keeps lost receipt unknown and does not expose provider secrets in errors', async () => {
  const f = setup(); f.fetchImpl.mockRejectedValue(Error('TEST_KEY PRIVATE_PROMPT'));
  await expect(f.jobs.submit(f.operation, input)).rejects.toMatchObject({code: 'submission-unknown'});
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  f.fetchImpl.mockResolvedValue(json({taskId: 'public-v1-task', status: 'pending'}));
  await expect(f.jobs.submit(v7(), input)).rejects.toMatchObject({code: 'submission-unknown'});
 });
 it('does not submit a pre-aborted request or accept injected headers', async () => {
  const f = setup(), abort = new AbortController(); abort.abort();
  await expect(f.jobs.submit(f.operation, input, abort.signal)).rejects.toMatchObject({submission: 'not-submitted'});
  for (const patch of [{apiKey: 'key\r\nX:1'}, {basicAuth: 'Bearer other-key'}, {userAgent: 'bad\nagent'}])
   expect(() => createPolloVideoJobs(f.spec, {...f.dependencies, ...patch})).toThrow('POLLO_CREDENTIALS_UNAVAILABLE');
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it('queries the same bound task after restart and leaves missing monetary usage unknown', async () => {
  const f = setup(); f.fetchImpl.mockResolvedValueOnce(json({code: 'SUCCESS', data: {id: 'task-1'}}));
  const ref = await f.jobs.submit(f.operation, input);
  f.fetchImpl.mockResolvedValueOnce(json({code: 'SUCCESS', data: {id: 'task-1', status: 'succeed', credit: 12, videoList: [{videoUrl: 'https://videocdn.pollo.ai/a.mp4'}]}}));
  const jobs = createPolloVideoJobs(f.spec, {...f.dependencies, apiKey: 'ROTATED_SAME_ACCOUNT'});
  const result = parseVideoJobSnapshot(await jobs.read(JSON.parse(JSON.stringify(ref))));
  expect(result).toEqual({taskId: 'task-1', status: 'succeeded', video: {url: 'https://videocdn.pollo.ai/a.mp4', duration: 5, resolution: '480P', ratio: '16:9'}});
  expect(result.usage).toBeUndefined();
  expect(f.fetchImpl.mock.calls[1]![0]).toBe('https://test123.pollo.ai/api/platform/generation/task-1');
  expect(f.fetchImpl.mock.calls[1]![1]?.method).toBe('GET');
 });
 it('normalizes numeric platform IDs and accepts the documented no-watermark-only result after restart', async () => {
  const f = setup(); f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id: 12345}}));
  const ref = await f.jobs.submit(f.operation, input); expect(ref.taskId).toBe('12345');
  f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id: 12345, status: 'succeed', videoList: [{videoUrl: null, videoUrlNoWatermark: 'https://videocdn.pollo.ai/a.mp4'}]}}));
  const restarted = createPolloVideoJobs(f.spec, f.dependencies);
  expect((await restarted.read(JSON.parse(JSON.stringify(ref)))).video?.url).toBe('https://videocdn.pollo.ai/a.mp4');
  expect(f.fetchImpl.mock.calls[1]![0]).toBe('https://test123.pollo.ai/api/platform/generation/12345');
 });
 it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, {}])('keeps invalid numeric receipt %j unknown instead of querying an invented ID', async id => {
  const f = setup(); f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id}}));
  await expect(f.jobs.submit(f.operation, input)).rejects.toMatchObject({code: 'submission-unknown'});
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('passes the original frontend directory contract with separate Pollo model and test region', () => {
  const f = setup(), directory = {protocolVersion: 1, datasetId: v7(), status: 'ready', items: f.registry.list()};
  expect(parseBindingDirectory(directory)).toEqual(directory);
  const item = directory.items[0]!;
  expect(() => parseBindingDirectory({...directory, items: [{...item, region: 'cn'}]})).toThrow();
  expect(() => parseBindingDirectory({...directory, items: [{...item, providerId: 'minimax'}]})).toThrow();
 });
 it.each([['waiting', 'queued'], ['processing', 'running'], ['failed', 'failed']] as const)('normalizes internal status %s, with optional echoed task id', async (status, normalized) => {
  const f = setup(); f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id: 'task-1'}}));
  const ref = await f.jobs.submit(f.operation, input);
  f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {status}}));
  expect(await f.jobs.read(ref)).toEqual({taskId: 'task-1', status: normalized});
 });
 it('rejects cross-account, cross-environment and cross-provider recovery before transport', async () => {
  const f = setup(); f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id: 'task-1'}}));
  const ref = await f.jobs.submit(f.operation, input); f.fetchImpl.mockClear();
  for (const change of [{providerId: 'minimax'}, {region: 'production'}, {accountScopeId: 'other'}, {modelId: 'MiniMax-H3-Max'}, {bindingHash: '0'.repeat(64)}, {taskId: '../../other'}])
   await expect(f.jobs.read({...ref, ...change})).rejects.toThrow('INVALID_PROVIDER_TASK_REFERENCE');
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it('rejects mismatched ids, unknown state, wrong model, multiple output and unsafe URLs', async () => {
  const f = setup(); f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {id: 'task-1'}}));
  const ref = await f.jobs.submit(f.operation, input);
  const data = {id: 'task-1', status: 'succeed', videoList: [{videoUrl: 'https://videocdn.pollo.ai/a.mp4'}]};
  for (const change of [{id: 'task-2'}, {status: 'mystery'}, {videoModel: 'other'}, {videoList: []}, {videoList: [...data.videoList, ...data.videoList]},
   {videoList: [{videoUrl: 'http://example.com/a.mp4'}]}, {videoList: [{videoUrl: 'https://user:pass@example.com/a.mp4'}]}]) {
   f.fetchImpl.mockResolvedValue(json({code: 'SUCCESS', data: {...data, ...change}}));
   await expect(f.jobs.read(ref)).rejects.toMatchObject({code: 'invalid-response'});
  }
 });
 it('cancels oversized streams and rejects login HTML without logging it', async () => {
  const f = setup(), cancel = vi.fn();
  f.fetchImpl.mockResolvedValue(new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array(262145));}, cancel}), {headers: {'content-type': 'application/json'}}));
  await expect(f.jobs.submit(f.operation, input)).rejects.toMatchObject({code: 'submission-unknown'}); expect(cancel).toHaveBeenCalled();
  f.fetchImpl.mockResolvedValue(new Response('<html>PRIVATE</html>', {headers: {'content-type': 'text/html'}}));
  await expect(f.jobs.submit(v7(), input)).rejects.toMatchObject({code: 'submission-unknown'});
 });
 it('pins production to its own endpoint without a hidden test fallback', () => {
  const f = setup('production'); expect(f.spec.parameters.endpointProfileId).toBe('pollo-production-platform');
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
});
