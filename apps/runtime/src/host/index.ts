import {createStoryDraftService} from '../composition/story-draft-service.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {openRuntimeDatabase} from '../infrastructure/db/client.js';
import {join} from 'node:path';
import {checkedFile, recheckTarget, validatedHost, type LocalEnvironment} from './storage.js';
import {createSessionOperations} from './sessions.js';

export {initializeLocalHost, readLocalHost} from './storage.js';
export type {HostManifest, LocalEnvironment} from './storage.js';
export const {issueConnectionCode, exchangeConnectionCode, authenticateSession, revokeSession} = createSessionOperations();

// Public application errors are fixed identifiers, never SQLite paths, queries or callback details.
const publicErrors = new Set(['DATASET_CHANGED', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'STORY_NOT_FOUND', 'STORY_NOT_DELETED', 'REVISION_EXHAUSTED',
  'OWNER_UNAVAILABLE', 'INVALID_STORY_COMMAND', 'INVALID_STORY_INPUT', 'INVALID_STORY_QUERY', 'INVALID_CURSOR', 'INVALID_ID', 'STORED_STORY_INVALID', 'COMMAND_RECEIPT_INVALID']);
export async function withLocalStories<T>(directory: string, environment: LocalEnvironment, token: string,
  work: (service: ReturnType<typeof createStoryDraftService>, owner: InternalOwnerContext) => Promise<T>): Promise<T> {
  const owner = await authenticateSession(directory, environment, token);
  try {
    const host = await validatedHost(directory, environment);
    if (host.manifest.ownerId !== owner.ownerId) throw new Error('LOCAL_STORIES_FAILED');
    if (host.manifest.datasetId !== owner.datasetId) throw new Error('DATASET_CHANGED');
    const path = join(host.target.directory, 'runtime.db');
    await checkedFile(path); await recheckTarget(host.target, host.identity);
    const db = await openRuntimeDatabase(path);
    try {
      await recheckTarget(host.target, host.identity);
      const current = await authenticateSession(directory, environment, token);
      if (current.ownerId !== owner.ownerId || current.ownerId !== host.manifest.ownerId) throw new Error('LOCAL_STORIES_FAILED');
      if (current.datasetId !== owner.datasetId || current.datasetId !== host.manifest.datasetId) throw new Error('DATASET_CHANGED');
      return await work(createStoryDraftService(db), owner);
    } finally {await db.$disconnect();}
  } catch (error) {
    if (error instanceof Error && (publicErrors.has(error.message) || error.message === 'LOCAL_SESSION_INVALID')) throw new Error(error.message);
    throw new Error('LOCAL_STORIES_FAILED');
  }
}
