import {createExperienceHistory} from '../application/experience-history.js';
export type HistoryService=ReturnType<typeof createExperienceHistory>;
import {createGenerationPlayback} from '../application/generation-playback.js';
import {createGenerationService} from '../application/generation.js';
import {localGenerationRuntime} from './generation-runtime.js';
import {openGenerationMedia} from '../application/generation-media.js';
import {createPrivateVideoReader} from '../infrastructure/media/private-video-store.js';
import type {GetGenerationMedia} from '../contracts/generation-media.js';
import type {PrivateVideoReader} from '../ports/private-video.js';
export type {PrivateVideoReader} from '../ports/private-video.js';
import {acquireLocalStoreAuthority} from './store-epoch.js';
import {createCharacterService} from '../composition/character-service.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import {createStoryDraftService} from '../composition/story-draft-service.js';
import {createExperienceOpeningService} from '../composition/experience-opening-service.js';
import {localProviderStartup} from './provider-startup.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {openRuntimeDatabase} from '../infrastructure/db/client.js';
import {join} from 'node:path';
import {checkedFile, recheckTarget, sameFile, validatedHost, type ValidatedHost, type LocalEnvironment} from './storage.js';
import {createSessionOperations} from './sessions.js';
import {assetErrors, bindAssets} from './assets.js';
import type {AssetService} from '../ports/asset-service.js';
import {createAssetMaintenance} from '../application/asset-maintenance.js';
import {PrismaAssetMaintenanceStore} from '../infrastructure/db/prisma-asset-maintenance-store.js';
import type {AssetMaintenanceInput,AssetMaintenanceResult} from '../ports/asset-maintenance.js';
export type {AssetMaintenanceInput,AssetMaintenanceResult} from '../ports/asset-maintenance.js';
export type {AssetService} from '../ports/asset-service.js';
export type {ImageBodySource} from '../ports/image-body-receiver.js';

export {initializeLocalHost, readLocalHost} from './storage.js';
export type {HostManifest, LocalEnvironment} from './storage.js';
export const {issueConnectionCode, exchangeConnectionCode, authenticateSession, revokeSession} = createSessionOperations();
/** Explicit launcher-only loading. Request paths never initialize or reload provider configuration. */
export const initializeLocalVideoProviders = localProviderStartup.initialize;
export const initializeLocalGeneration = localGenerationRuntime.initialize;
export const startLocalGeneration = localGenerationRuntime.start;
export const stopLocalGeneration = localGenerationRuntime.stop;

// Public application errors are fixed identifiers, never SQLite paths, queries or callback details.
const storyErrors = new Set(['CLIENT_RELOAD_REQUIRED', 'TEMPLATE_REVISION_CONFLICT', 'CHARACTER_NOT_FOUND', 'ASSET_NOT_FOUND', 'STORY_ASSET_NOT_READY', 'DATASET_CHANGED', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'STORY_NOT_FOUND', 'STORY_NOT_DELETED', 'REVISION_EXHAUSTED',
  'OWNER_UNAVAILABLE', 'INVALID_STORY_COMMAND', 'INVALID_STORY_INPUT', 'INVALID_STORY_QUERY', 'INVALID_CURSOR', 'INVALID_ID', 'STORED_STORY_INVALID', 'COMMAND_RECEIPT_INVALID']);
const characterErrors = new Set(['DATASET_CHANGED', 'OWNER_UNAVAILABLE', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'REVISION_EXHAUSTED',
  'CHARACTER_NOT_FOUND', 'CHARACTER_NOT_DELETED', 'INVALID_CHARACTER_COMMAND', 'INVALID_CHARACTER_QUERY', 'INVALID_CHARACTER_PORTRAIT',
  'INVALID_CURSOR', 'STORED_CHARACTER_INVALID', 'COMMAND_RECEIPT_INVALID']);
const openingErrors = new Set(['CLIENT_RELOAD_REQUIRED', 'DATASET_CHANGED', 'OWNER_UNAVAILABLE', 'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT', 'REVISION_EXHAUSTED', 'INVALID_EXPERIENCE_COMMAND', 'INVALID_EXPERIENCE_QUERY', 'INVALID_EXPERIENCE_CURSOR',
  'INVALID_EXPERIENCE_DTO', 'STORY_NOT_FOUND', 'STORY_ARCHIVED', 'STORY_ASSET_NOT_READY', 'EXPERIENCE_NOT_FOUND',
  'PREPARATION_NO_LONGER_CURRENT', 'STORED_EXPERIENCE_INVALID', 'STORED_STORY_VERSION_INVALID', 'COMMAND_RECEIPT_INVALID',
  'INVALID_PROVIDER_BINDING', 'PROVIDER_BINDING_MISMATCH', 'PROVIDER_BINDING_CONFLICT', 'STORED_PROVIDER_BINDING_INVALID',
  'PROVIDER_BINDING_NOT_REGISTERED', 'PROVIDER_CONFIGURATION_UNAVAILABLE', 'PROVIDER_NOT_INITIALIZED', 'EXPERIENCE_PARENT_INVALID']);

type DatabaseBinding = {host: ValidatedHost; revalidate: () => Promise<void>};
// Shared host resource/authentication boundary only, not a generic business service.
// Asset operations opt into lifetime pinning; existing story/character call contracts
// retain their two-authentication semantics and the same disconnect/error owner.
async function withLocalDatabase<T>(directory: string, environment: LocalEnvironment, token: string,
  publicErrors: ReadonlySet<string>, failure: string,
  work: (db: PrismaClient, owner: InternalOwnerContext, binding: DatabaseBinding) => Promise<T>, pinFiles = false): Promise<T> {
  const owner = Object.freeze(await authenticateSession(directory, environment, token));
  try {
    const host = await validatedHost(directory, environment);
    if (host.manifest.ownerId !== owner.ownerId) throw new Error(failure);
    if (host.manifest.datasetId !== owner.datasetId) throw new Error('DATASET_CHANGED');
    const manifest = JSON.stringify(host.manifest), path = join(host.target.directory, 'runtime.db');
    const databaseIdentity = await checkedFile(path);
    await recheckTarget(host.target, host.identity);
    let closed = false;
    const verifyPinned = async () => {
      await recheckTarget(host.target, host.identity);
      // validatedHost reuses the existing optional WAL/SHM/journal disappearance policy.
      const current = await validatedHost(host.target.directory, environment);
      if (!sameFile(current.identity, host.identity) || !sameFile(current.target.parentIdentity, host.target.parentIdentity)) throw new Error('LOCAL_HOST_INVALID');
      if (current.manifest.datasetId !== owner.datasetId) throw new Error('DATASET_CHANGED');
      if (JSON.stringify(current.manifest) !== manifest || !sameFile(await checkedFile(path), databaseIdentity)) throw new Error('LOCAL_HOST_INVALID');
    };
    const revalidate = async () => {
      if (closed) throw new Error('LOCAL_HOST_INVALID');
      if (pinFiles) await verifyPinned();
      else await recheckTarget(host.target, host.identity);
      const current = await authenticateSession(directory, environment, token);
      if (current.ownerId !== owner.ownerId || current.ownerId !== host.manifest.ownerId) throw new Error(failure);
      if (current.datasetId !== owner.datasetId || current.datasetId !== host.manifest.datasetId) throw new Error('DATASET_CHANGED');
      // Authentication performs awaits against filesystem credentials. Never adopt
      // its freshly valid host as our binding; compare again with the original pins.
      if (pinFiles) await verifyPinned();
    };
    const db = await openRuntimeDatabase(path);
    try {
      await revalidate();
      return await work(db, owner, {host, revalidate});
    } finally {closed = true; await db.$disconnect();}
  } catch (error) {
    if (error instanceof Error && (publicErrors.has(error.message) || error.message === 'LOCAL_SESSION_INVALID')) throw new Error(error.message);
    throw new Error(failure);
  }
}

export function withLocalStories<T>(directory: string, environment: LocalEnvironment, token: string,
  work: (service: ReturnType<typeof createStoryDraftService>, owner: InternalOwnerContext) => Promise<T>): Promise<T> {
  return withLocalDatabase(directory, environment, token, storyErrors, 'LOCAL_STORIES_FAILED', (db, owner) => work(createStoryDraftService(db), owner));
}
export function withLocalCharacters<T>(directory: string, environment: LocalEnvironment, token: string,
  work: (service: ReturnType<typeof createCharacterService>, owner: InternalOwnerContext) => Promise<T>): Promise<T> {
  return withLocalDatabase(directory, environment, token, characterErrors, 'LOCAL_CHARACTERS_FAILED', (db, owner) => work(createCharacterService(db), owner));
}

export function withLocalExperienceOpenings<T>(directory: string, environment: LocalEnvironment, token: string,
  work: (service: ReturnType<typeof createExperienceOpeningService> & {bindings: () => import('../contracts/video-binding-registry.js').BindingDirectory}, owner: InternalOwnerContext) => Promise<T>): Promise<T> {
  return withLocalDatabase(directory, environment, token, openingErrors, 'LOCAL_EXPERIENCES_FAILED', (db, owner) => {
    const providers = localProviderStartup.access(directory, environment, owner);
    // Failure is lazy: historical CREATE replay/get never depend on today's registry health.
    return work({...createExperienceOpeningService(db, providers.resolver), bindings: providers.directory}, owner);
  });
}

/** Fixed trusted owner/dataset; no request-supplied scope or file factory injection.
 * Revalidation is not atomic with SQLite commits and does not recall sent bytes.
 * Work must await its service operations before this boundary disconnects. */
export function withLocalAssets<T>(directory: string, environment: LocalEnvironment, token: string,
  work: (service: AssetService) => Promise<T>): Promise<T> {
  return withLocalDatabase(directory, environment, token, assetErrors, 'LOCAL_ASSETS_FAILED',
    (db, owner, {host, revalidate}) => work(bindAssets(db, owner, host, revalidate)), true);
}

const maintenanceErrors = new Set([...assetErrors, 'INVALID_ASSET_MAINTENANCE',
  'INVALID_ASSET_MAINTENANCE_CURSOR', 'ASSET_MAINTENANCE_FAILED']);
/** Explicit one-page operation only. Uses the same pinned authentication/database
 * boundary and lazy file store as uploads; never attached to startup or HTTP reads. */
export function maintainLocalAssets(directory: string, environment: LocalEnvironment, token: string,
  input: AssetMaintenanceInput): Promise<AssetMaintenanceResult> {
  return withLocalDatabase(directory, environment, token, maintenanceErrors, 'LOCAL_ASSET_MAINTENANCE_FAILED',
    (db, owner, {host, revalidate}) => {
      const assets = bindAssets(db, owner, host, revalidate);
      return createAssetMaintenance(new PrismaAssetMaintenanceStore(db), {owner, revalidate, cleanup: assets.cleanup})(input);
    }, true);
}

const playbackErrors = new Set(['CLIENT_RELOAD_REQUIRED', 'DATASET_CHANGED', 'OWNER_UNAVAILABLE', 'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT', 'REVISION_EXHAUSTED', 'INVALID_GENERATION_COMMAND', 'INVALID_GENERATION_QUERY',
  'GENERATION_CONTEXT_LIMIT','SCOPE_RECONCILIATION_REQUIRED','SNAPSHOT_MISMATCH','HISTORY_PREFIX_LIMIT','GENERATION_BUDGET_INVALID','PLAYBACK_MEDIA_UNAVAILABLE','PLAYBACK_SESSION_UNAVAILABLE','PLAYBACK_PROGRESS_CONFLICT','PLAYBACK_COVERAGE_INCOMPLETE','SAVEPOINT_SOURCE_UNAVAILABLE',
  'EXPERIENCE_NOT_FOUND', 'GENERATION_NOT_PLAYABLE', 'GENERATION_CONTENT_UNCONFIRMED', 'STORE_AUTHORITY_UNAVAILABLE']);
const generationErrors = new Set([...playbackErrors, 'GENERATION_QUOTE_NOT_FOUND', 'GENERATION_QUOTE_STALE', 'GENERATION_QUOTE_EXPIRED', 'GENERATION_QUOTE_CONSUMED',
 'GENERATION_NOT_AWAITING', 'GENERATION_BUDGET_EXCEEDED', 'GENERATION_STAGE_BUDGET_EXCEEDED', 'GENERATION_POLICY_UNAVAILABLE', 'GENERATION_PRICE_UNAVAILABLE',
 'GENERATION_RUNTIME_UNAVAILABLE', 'GENERATION_PROFILE_UNAVAILABLE', 'STORY_ASSET_NOT_READY', 'PREPARATION_NO_LONGER_CURRENT']);
export function withLocalGeneration<T>(directory: string, environment: LocalEnvironment, token: string,
 work: (service: ReturnType<typeof createGenerationService>, owner: InternalOwnerContext) => Promise<T>): Promise<T> {
 return withLocalDatabase(directory, environment, token, generationErrors, 'LOCAL_GENERATION_FAILED', async (db, owner, {revalidate}) => {
  const capture = await acquireLocalStoreAuthority(directory, environment), authority = {...capture, revalidate: async () => {await revalidate();await capture.revalidate();}};
  return work(createGenerationService(db, owner, authority, localGenerationRuntime.access(directory, environment, owner).policy), owner);
 }, true);
}
/** Uses the original local session and SQLite host. Reads and playback receipts never submit generation. */
export function withLocalGenerationPlayback<T>(directory: string, environment: LocalEnvironment, token: string,
  work: (service: ReturnType<typeof createGenerationPlayback>, owner: InternalOwnerContext) => Promise<T>): Promise<T> {
  return withLocalDatabase(directory, environment, token, playbackErrors, 'LOCAL_GENERATION_FAILED',
    async (db, owner, {revalidate,host}) => {
      const captured = await acquireLocalStoreAuthority(directory, environment);
      const authority = {...captured, revalidate: async () => {await revalidate(); await captured.revalidate();}};
      return work(createGenerationPlayback(db, owner, authority, undefined, async metadata=>{const reader=await (await createPrivateVideoReader(host,owner,authority.revalidate)).open(metadata);await reader.close();}), owner);
    }, true);
}

const mediaErrors = new Set(['DATASET_CHANGED', 'OWNER_UNAVAILABLE', 'INVALID_GENERATION_MEDIA_QUERY', 'GENERATION_MEDIA_NOT_FOUND']);
/** The returned verified descriptor outlives SQLite. Its HTTP owner must close it on end/cancel/error. */
export async function openLocalGenerationMedia(directory: string, environment: LocalEnvironment, token: string,
  input: GetGenerationMedia): Promise<PrivateVideoReader> {
  let reader: PrivateVideoReader | undefined;
  try {
    return await withLocalDatabase(directory, environment, token, mediaErrors, 'LOCAL_GENERATION_MEDIA_FAILED',
      async (db, owner, {host, revalidate}) => {
        const files = {open: async (metadata: import('../ports/private-video.js').PrivateVideoMetadata) =>
          (await createPrivateVideoReader(host, owner, revalidate)).open(metadata)};
        reader = await openGenerationMedia(db, owner, input, files, revalidate);return reader;
      }, true);
  } catch (error) {await reader?.close();throw error;}
}

export function withLocalHistory<T>(directory:string,environment:LocalEnvironment,token:string,work:(service:HistoryService,owner:InternalOwnerContext)=>Promise<T>):Promise<T>{
 return withLocalDatabase(directory,environment,token,new Set([...playbackErrors,'STORY_ASSET_NOT_READY']),'LOCAL_GENERATION_FAILED',async(db,owner,{host,revalidate})=>{
  const captured=await acquireLocalStoreAuthority(directory,environment),authority={...captured,revalidate:async()=>{await revalidate();await captured.revalidate();}};
  const videos=await createPrivateVideoReader(host,owner,authority.revalidate),assets=bindAssets(db,owner,host,authority.revalidate);
  return work(createExperienceHistory(db,owner,authority,{
   verifyVideo:async metadata=>{try{const reader=await videos.open(metadata);await reader.close();}catch{throw Error('PLAYBACK_MEDIA_UNAVAILABLE');}},
   verifyAsset:async assetId=>{await assets.getBytes({datasetId:owner.datasetId,assetId});},
  }),owner);
 },true);
}
