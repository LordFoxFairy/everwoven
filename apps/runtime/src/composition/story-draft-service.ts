import type {PrismaClient} from '../generated/prisma/client.js';
import type {DraftCreate, DraftUpdate, DraftLifecycle, DraftListInput, InternalOwnerContext} from '../contracts/story-draft.js';
import {createDraft, getDraft, listDrafts, updateDraft, deleteDraft, restoreDraft} from '../application/story-drafts.js';
import {systemServices, type RuntimeServices} from '../application/runtime-services.js';
import {PrismaStoryDraftStore} from '../infrastructure/db/prisma-story-draft-store.js';

/** Explicit host composition only: no global container, profile bootstrap or HTTP authority. */
export function createStoryDraftService(db: PrismaClient, services: RuntimeServices = systemServices) {
  const store = new PrismaStoryDraftStore(db);
  return {
    create: (owner: InternalOwnerContext, input: DraftCreate) => createDraft(store, owner, input, services),
    get: (owner: InternalOwnerContext, id: string, includeDeleted = false) => getDraft(store, owner, id, includeDeleted),
    list: (owner: InternalOwnerContext, input?: DraftListInput) => listDrafts(store, owner, input),
    update: (owner: InternalOwnerContext, input: DraftUpdate) => updateDraft(store, owner, input, services),
    delete: (owner: InternalOwnerContext, input: DraftLifecycle) => deleteDraft(store, owner, input, services),
    restore: (owner: InternalOwnerContext, input: DraftLifecycle) => restoreDraft(store, owner, input, services),
  };
}
