import {createCharacterService} from '../composition/character-service.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import {createStoryDraftService} from '../composition/story-draft-service.js';
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

// Public application errors are fixed identifiers, never SQLite paths, queries or callback details.
const storyErrors = new Set(['DATASET_CHANGED', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'STORY_NOT_FOUND', 'STORY_NOT_DELETED', 'REVISION_EXHAUSTED',
  'OWNER_UNAVAILABLE', 'INVALID_STORY_COMMAND', 'INVALID_STORY_INPUT', 'INVALID_STORY_QUERY', 'INVALID_CURSOR', 'INVALID_ID', 'STORED_STORY_INVALID', 'COMMAND_RECEIPT_INVALID']);
const characterErrors = new Set(['DATASET_CHANGED', 'OWNER_UNAVAILABLE', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'REVISION_EXHAUSTED',
  'CHARACTER_NOT_FOUND', 'CHARACTER_NOT_DELETED', 'INVALID_CHARACTER_COMMAND', 'INVALID_CHARACTER_QUERY', 'INVALID_CHARACTER_PORTRAIT',
  'INVALID_CURSOR', 'STORED_CHARACTER_INVALID', 'COMMAND_RECEIPT_INVALID']);

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
