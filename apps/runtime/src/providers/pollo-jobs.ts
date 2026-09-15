import {createHash} from 'node:crypto';
import {canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {isBusinessId, isTimestamp} from '../contracts/primitives.js';
import {fields} from '../contracts/story-draft-validation.js';
import type {PreparedVideoInput, VideoJobAdapter, VideoJobSnapshot, VideoTaskReference} from '../ports/video-jobs.js';
import {polloEndpoints, polloRegion, validatePolloBinding} from './pollo-capabilities.js';

export class PolloJobError extends Error {
 constructor(readonly code: 'not-submitted' | 'submission-unknown' | 'query-unavailable' | 'invalid-response',
  readonly submission: 'not-submitted' | 'unknown' | null = null, readonly httpStatus?: number) {
  super(code === 'submission-unknown' ? '提交结果尚未确认，请核对原任务' : 'Pollo 请求未通过验证');
  this.name = 'PolloJobError';
 }
}
type Dependencies = {apiKey: string; basicAuth?: string; userAgent?: string; fetchImpl?: typeof fetch; timeoutMs?: number};
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(v);
function taskIdentifier(value: unknown): string {
 if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
 if (validId(value)) return value;
 throw Error('INVALID_POLLO_TASK_ID');
}
function object(v: unknown): Record<string, unknown> {
 if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('INVALID_POLLO_RESPONSE');
 return v as Record<string, unknown>;
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
 if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error();
 const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
 const abort = () => {void reader.cancel().catch(() => {});}; signal.addEventListener('abort', abort, {once: true});
 try {
  while (true) {
   signal.throwIfAborted(); const {done, value} = await reader.read(); signal.throwIfAborted(); if (done) break;
   size += value.byteLength; if (size > 262144) throw Error(); chunks.push(value);
  }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
 } finally {signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock();}
}

/** One internal-platform task. Binding pins supplier/account/model/endpoint/spec; no fallback or paid retry. */
export function createPolloVideoJobs(raw: unknown, dependencies: Dependencies): VideoJobAdapter {
 const {id, createdAt, ...spec} = object(raw), binding = validatePolloBinding(spec), p = binding.parameters;
 if (!isBusinessId(id) || !(createdAt instanceof Date) || !isTimestamp(createdAt.toISOString())) throw Error('INVALID_PROVIDER_BINDING');
 const {apiKey, basicAuth, userAgent = 'HIX.AI WEBBOT Request', fetchImpl = fetch, timeoutMs = 15000} = dependencies;
 if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) || apiKey.length > 4096 ||
  typeof userAgent !== 'string' || !userAgent.trim() || userAgent.length > 512 || /[\r\n]/.test(userAgent) ||
  (basicAuth !== undefined && (typeof basicAuth !== 'string' || !/^Basic [A-Za-z0-9+/]+=*$/.test(basicAuth) || basicAuth.length > 4096)) ||
  !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('POLLO_CREDENTIALS_UNAVAILABLE');
 const region = polloRegion(p.region), base = polloEndpoints[region].base;
 const bindingHash = createHash('sha256').update(JSON.stringify(canonicalBindingJson(binding))).digest('hex');
 const identity = {providerId: 'pollo', bindingId: id, bindingHash, connectionId: p.connectionId,
  accountScopeId: p.providerAccountScopeId, region, modelId: binding.modelId};
 function reference(raw: unknown): VideoTaskReference {
  try {
   fields(raw, ['providerId', 'operationId', 'taskId', 'bindingId', 'bindingHash', 'connectionId', 'accountScopeId', 'region', 'modelId', 'requestHash', 'firstSubmittedAt']);
   if (!isBusinessId(raw.operationId) || !validId(raw.taskId) || !isTimestamp(raw.firstSubmittedAt) ||
    typeof raw.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.requestHash) || Object.entries(identity).some(([k, v]) => raw[k] !== v)) throw Error();
   return {...raw} as VideoTaskReference;
  } catch {throw Error('INVALID_PROVIDER_TASK_REFERENCE');}
 }
 function validatePrepared(raw: unknown): PreparedVideoInput {
  fields(raw, ['prompt', 'duration', 'resolution', 'ratio']);
  const g = p.generation;
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 7000 ||
   raw.duration !== g.duration || raw.resolution !== g.resolution || raw.ratio !== g.ratio) throw Error('PREPARED_REQUEST_OUTSIDE_BINDING');
  return {prompt: raw.prompt.trim(), duration: g.duration as number, resolution: g.resolution as string, ratio: g.ratio as string};
 }
 async function request(method: 'GET' | 'POST', path: string, body?: string, parent?: AbortSignal) {
  const creating = method === 'POST';
  if (parent?.aborted) throw new PolloJobError(creating ? 'not-submitted' : 'query-unavailable', creating ? 'not-submitted' : null);
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(parent ? [parent] : [])]);
  try {
   const response = await fetchImpl(base + path, {method, body, signal, redirect: 'manual', headers: {
    'x-api-key': apiKey.trim(), 'User-Agent': userAgent, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(basicAuth ? {Authorization: basicAuth} : {}),
   }});
   if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new PolloJobError(creating ? 'submission-unknown' : 'query-unavailable', creating ? 'unknown' : null, response.status);
   }
   return object(await json(response, signal));
  } catch (error) {
   if (error instanceof PolloJobError) throw error;
   // Never include provider bodies, prompts, URLs, credentials or transport causes in errors.
   throw new PolloJobError(creating ? 'submission-unknown' : 'query-unavailable', creating ? 'unknown' : null);
  }
 }
 return {mode: 'job', bindingId: id, bindingHash, validatePrepared, reference,
  prepare(input) {fields(input, ['prompt']); return validatePrepared({prompt: input.prompt, ...p.generation});},
  async submit(operationId, input, signal) {
   if (!isBusinessId(operationId)) throw Error('INVALID_PROVIDER_OPERATION');
   const prepared = validatePrepared(input);
   const body = JSON.stringify({generationInput: {videoModel: binding.modelId, prompt: prepared.prompt,
    resolution: prepared.resolution, length: prepared.duration, aspectRatio: prepared.ratio,
    numOutputs: 1, published: false, protectionMode: true, enableMagicPrompt: false, enableTranslatePrompt: false,
   }, sort: 0});
   const firstSubmittedAt = new Date().toISOString(), requestHash = createHash('sha256').update(body).digest('hex');
   const response = await request('POST', '/generation/text2video', body, signal);
   let taskId: string;
   try {if (response.code !== 'SUCCESS') throw Error(); taskId = taskIdentifier(object(response.data).id);}
   catch {throw new PolloJobError('submission-unknown', 'unknown');}
   return {...identity, operationId, taskId, requestHash, firstSubmittedAt};
  },
  async read(raw, signal): Promise<VideoJobSnapshot> {
   const ref = reference(raw), response = await request('GET', `/generation/${encodeURIComponent(ref.taskId)}`, undefined, signal);
   try {
    if (response.code !== 'SUCCESS') throw Error();
    const data = object(response.data);
    // The existing consumer's response contract permits omitted id/model. The authenticated GET
    // already targets the bound task; any echoed identity must match it.
    if ((data.id !== undefined && taskIdentifier(data.id) !== ref.taskId) || (data.videoModel !== undefined && data.videoModel !== binding.modelId)) throw Error();
    const statuses: Record<string, VideoJobSnapshot['status']> = {waiting: 'queued', processing: 'running', succeed: 'succeeded', failed: 'failed'};
    if (typeof data.status !== 'string' || !Object.hasOwn(statuses, data.status)) throw Error();
    const result: VideoJobSnapshot = {taskId: ref.taskId, status: statuses[data.status]!};
    if (result.status === 'succeeded') {
     if (!Array.isArray(data.videoList) || data.videoList.length !== 1) throw Error();
     const video = object(data.videoList[0]);
     const videoUrl = video.videoUrlNoWatermark ?? video.videoUrl;
     if (typeof videoUrl !== 'string' || videoUrl.length > 8192 || videoUrl !== videoUrl.trim()) throw Error();
     const url = new URL(videoUrl); if (url.protocol !== 'https:' || url.username || url.password) throw Error();
     // These are SEALED REQUEST expectations, not observed dimensions or billable usage.
     // The private media probe verifies actual duration/pixels/codec before playback.
     result.video = {url: videoUrl, duration: p.generation.duration as number,
      resolution: p.generation.resolution as string, ratio: p.generation.ratio as string};
    }
    // Internal credit units have no verified currency conversion. Do not fabricate usage or dollar charges.
    return result;
   } catch {throw new PolloJobError('invalid-response');}
  },
 };
}
