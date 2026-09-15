import {validateMiniMaxBinding} from '../providers/minimax-capabilities.js';
import {sceneArtifacts} from '../application/scene-artifacts.js';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isDeepStrictEqual} from 'node:util';
import {fields} from '../contracts/story-draft-validation.js';
import {parseExecutionProfile} from '../contracts/execution-profile.js';
import {parsePrivateVideoMetadata} from '../contracts/private-video.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {LocalStoreAuthority} from './store-epoch.js';
import type {ValidatedHost} from './storage.js';
import {sameFile} from './storage.js';
import type {GenerationPolicy} from '../ports/generation-policy.js';
import type {PinnedProfile} from '../ports/execution-profile-store.js';
import {generationBindingHash} from '../application/generation.js';
import {createPersistedGenerationExecutor} from '../composition/generation-executor.js';
import {createOpenRouterText} from '../providers/openrouter-text.js';
import {createMiniMaxVideoJobs} from '../providers/minimax-jobs.js';
import {createPolloVideoJobs} from '../providers/pollo-jobs.js';
import {validatePolloBinding} from '../providers/pollo-capabilities.js';
import {createPrivateVideoStore} from '../infrastructure/media/private-video-store.js';
import {createVideoDownloadSource} from '../infrastructure/media/video-download.js';
import {createVideoProbe} from '../infrastructure/media/video-probe.js';
import {samplePrivateVideo} from '../infrastructure/media/video-frame-sampler.js';

export type GenerationInstallation = {policy: GenerationPolicy; executor: ReturnType<typeof createPersistedGenerationExecutor>};
/** Private operator configuration, loaded once. No HTTP API accepts this document or model credentials. */
export async function loadGenerationInstallation(db: PrismaClient, host: ValidatedHost, owner: InternalOwnerContext,
 authority: LocalStoreAuthority, env: Record<string, string | undefined>): Promise<GenerationInstallation> {
 const file = await open(join(host.target.directory, 'generation.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  .catch(() => {throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');});
 let input: unknown;
 try {
  const before = await file.stat();
  if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o600 || before.size < 2 || before.size > 524288) throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
  const bytes = Buffer.alloc(before.size + 1), read = await file.read(bytes, 0, bytes.length, 0), after = await file.stat();
  if (read.bytesRead !== before.size || !sameFile(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
  input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, read.bytesRead)));
 } finally {await file.close();}
 await authority.revalidate();
 fields(input, ['schemaVersion', 'profiles']);
 if (input.schemaVersion !== 1 || !Array.isArray(input.profiles) || !input.profiles.length || input.profiles.length > 8) throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
 const records = input.profiles.map(raw => {
  fields(raw, ['profile', 'prices', 'audio', 'validatorImageLimit', 'textInputBounds', 'dimensions', 'cdnHosts']);
  const profile = parseExecutionProfile(raw.profile);
  if (profile.ownerId !== owner.ownerId || !['native', 'silent'].includes(raw.audio as string) || !Number.isSafeInteger(raw.validatorImageLimit) ||
   (raw.validatorImageLimit as number) < 1 || (raw.validatorImageLimit as number) > 16) throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
  fields(raw.prices, ['planner', 'video', 'validator']);fields(raw.textInputBounds, ['planner', 'validator']);fields(raw.dimensions, ['width', 'height']);
  if (![raw.dimensions.width, raw.dimensions.height].every(x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 64 && x <= 8192) ||
   !Array.isArray(raw.cdnHosts) || !raw.cdnHosts.length || raw.cdnHosts.length > 16 || raw.cdnHosts.some(x => typeof x !== 'string')) throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
  const pollo = profile.video.binding.providerId === 'pollo';
  if ((!pollo && profile.video.binding.providerId !== 'minimax') || profile.video.binding.parameters.operationKind !== 'text-to-video') throw Error('GENERATION_VIDEO_PROVIDER_UNAVAILABLE');
  if (pollo) validatePolloBinding(profile.video.binding); else validateMiniMaxBinding(profile.video.binding);
  const artifacts=sceneArtifacts();
  if(!isDeepStrictEqual(profile.graph,artifacts.graph)||!isDeepStrictEqual(profile.planner.prompt,artifacts.planner.prompt)||!isDeepStrictEqual(profile.planner.outputSchema,artifacts.planner.outputSchema)||!isDeepStrictEqual(profile.validator.prompt,artifacts.validator.prompt)||!isDeepStrictEqual(profile.validator.outputSchema,artifacts.validator.outputSchema))throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
  assertGenerationDimensions(raw.dimensions.width as number,raw.dimensions.height as number,profile.video.binding.parameters.generation.ratio as string);
  const credential = (ref: string, provider: 'OPENROUTER' | 'MINIMAX' | 'POLLO') => {
   if (!new RegExp(`^env:${provider}_[A-Z0-9_]+$`).test(ref)) throw Error('GENERATION_CREDENTIALS_UNAVAILABLE');
   const value = env[ref.slice(4)];if (!value?.trim()) throw Error('GENERATION_CREDENTIALS_UNAVAILABLE');return value;
  };
  const text = (stage: 'planner' | 'validator') => {
   const binding = profile[stage].binding, bound = raw.textInputBounds as Record<string, unknown>;
   const evidence = bound[stage];fields(evidence, ['method', 'modelId', 'tokens', 'source']);
   // A full model input capacity is deliberately conservative. It is an explicit reviewed bound, not a character/token estimate.
   if (evidence.method !== 'context-window' || evidence.modelId !== binding.modelId || evidence.tokens !== binding.parameters.generation.maxInputTokens ||
    typeof evidence.source !== 'string' || !/^https:\/\/[^\s]+$/.test(evidence.source)) throw Error('GENERATION_INPUT_BOUND_UNAVAILABLE');
   return createOpenRouterText(binding, {apiKey: credential(binding.credentialRef, 'OPENROUTER'), countInputTokens: () => evidence.tokens as number});
  };
  const planner = text('planner'), validator = text('validator'), videoKey = credential(profile.video.binding.credentialRef, pollo ? 'POLLO' : 'MINIMAX');
  // Test gateway is a separate credential; never borrow another supplier's Authorization header.
  const basicAuth = pollo && profile.video.binding.parameters.region === 'test'
   ? credential('env:POLLO_SERVICE_BASIC_AUTH_KEY', 'POLLO') : undefined;
  const userAgent = pollo ? env.POLLO_SERVICE_UA : undefined;
  const evidence = {profile, prices: raw.prices as unknown as ReturnType<GenerationPolicy['resolve']>['prices'], audio: raw.audio as 'native' | 'silent',
   validatorImageLimit: raw.validatorImageLimit as number, artifactsReady: true as const};
  const dimensions = {width: raw.dimensions.width as number, height: raw.dimensions.height as number};
  const source = createVideoDownloadSource(raw.cdnHosts as string[]);
  return {evidence, videoHash: generationBindingHash(profile.video.binding), planner, validator, videoKey, basicAuth, userAgent, dimensions, source};
 });
 if (new Set(records.map(r => r.videoHash)).size !== records.length) throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
 // Check local executables, without any model or media request.
 await Promise.all(['ffmpeg', 'ffprobe'].map(binary => promisify(execFile)(binary, ['-version'], {timeout: 5000, maxBuffer: 16384})));
 const recordFor = (profile: PinnedProfile) => {
  const record = records.find(r => isDeepStrictEqual(r.evidence.profile, profile.snapshot));
  if (!record) throw Error('GENERATION_PROFILE_UNAVAILABLE');return record;
 };
 const storeFor = async (profile: PinnedProfile) => {
  const record = recordFor(profile);
  return createPrivateVideoStore(host, owner, {source: record.source, probe: createVideoProbe(() => record.dimensions), revalidate: authority.revalidate});
 };
 const executor = createPersistedGenerationExecutor(db, owner, authority, {
  assertVideoProfile: profile => {
   const record = recordFor(profile), binding = {...profile.snapshot.video.binding, id: profile.videoBindingVersionId, createdAt: profile.createdAt};
   // Constructing an adapter is pure. Reject malformed gateway credentials before the first paid text call.
   if (binding.providerId === 'pollo') createPolloVideoJobs(binding, {apiKey: record.videoKey, basicAuth: record.basicAuth, userAgent: record.userAgent});
   else createMiniMaxVideoJobs(binding, {apiKey: record.videoKey});
  },
  text: binding => {
   const hash = generationBindingHash(binding), model = records.flatMap(r => [r.planner, r.validator]).find(m => m.bindingHash === hash);
   if (!model) throw Error('GENERATION_PROFILE_UNAVAILABLE');return model;
  },
  jobs: binding => {
   const {id: _id, createdAt: _createdAt, ...spec} = binding, record = records.find(r => r.videoHash === generationBindingHash(spec));
   if (!record) throw Error('GENERATION_PROFILE_UNAVAILABLE');
   return binding.providerId === 'pollo'
    ? createPolloVideoJobs(binding, {apiKey: record.videoKey, basicAuth: record.basicAuth, userAgent: record.userAgent})
    : createMiniMaxVideoJobs(binding, {apiKey: record.videoKey});
  },
  materialize: async (context, video) => (await storeFor(context.profile)).materialize(context.turnId, video, context.signal),
  sample: async (context, media, signal) => {
   await authority.revalidate();
   const turn = await db.generationTurn.findFirst({where: {id: context.turnId, ownerId: owner.ownerId, experienceId: context.quote.experienceId, quoteId: context.quote.id, status: 'validating'}});
   const quote = turn && await db.generationQuote.findFirst({where: {id: turn.quoteId, ownerId: owner.ownerId, datasetId: owner.datasetId, acceptedTurnId: turn.id}});
   if (!turn || !quote) throw Error('GENERATION_MEDIA_NOT_FOUND');
   const metadata = parsePrivateVideoMetadata(turn.media);
   if (metadata.id !== media.id || metadata.sha256 !== media.sha256) throw Error('GENERATION_MEDIA_NOT_FOUND');
   return samplePrivateVideo(await (await storeFor(context.profile)).open(metadata), context.validatorImageLimit, signal);
  },
 });
 const policy: GenerationPolicy = {
  resolve: ({binding}) => {
   const {id: _id, createdAt: _createdAt, ...spec} = binding, record = records.find(r => r.videoHash === generationBindingHash(spec));
   if (!record) throw Error('GENERATION_PROFILE_UNAVAILABLE');return structuredClone(record.evidence);
  },
  assertDispatch: profile => executor.assertProfile(profile),
 };
 return {policy, executor};
}

export function assertGenerationDimensions(width:number,height:number,ratio:string) {
 if(![width,height].every(edge=>Number.isSafeInteger(edge)&&edge>=64&&edge<=8192)||width*height>33554432)throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
 if(ratio!=='adaptive'){
  const parts=/^([1-9][0-9]*):([1-9][0-9]*)$/.exec(ratio);
  if(!parts||Math.abs(width/height-Number(parts[1])/Number(parts[2]))>0.03)throw Error('GENERATION_CONFIGURATION_UNAVAILABLE');
 }
}
