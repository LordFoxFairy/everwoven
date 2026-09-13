import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {ExperienceOpeningStore, ExperienceOpeningReadScope, OpeningReceiptRecord, ExperienceRecord} from '../ports/experience-opening-store.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {CreateExperience, GetPreparingExperience, ExperienceOpeningDTO, ExperienceOpeningResult} from '../contracts/experience-opening.js';
import type {BindingResolver} from '../contracts/provider-binding.js';
import {systemServices, nextId, currentTime, type RuntimeServices} from './runtime-services.js';
import {parseOwner, parseId} from '../contracts/story-draft-validation.js';
import {parseCreateExperience, parseGetPreparingExperience} from '../contracts/experience-opening-validation.js';
import {freezeStoryInScope} from './story-versions.js';
import {pinBinding} from './provider-binding-snapshots.js';
import {assertOpeningAuthority, openingFacts, assertStillPreparing} from './experience-opening-facts.js';

const commandType = 'experience.create.v1';
function commandHash(owner: InternalOwnerContext, input: CreateExperience) {
  return createHash('sha256').update(JSON.stringify([commandType, owner.ownerId, owner.datasetId, input])).digest('hex');
}
function checkDataset(owner: InternalOwnerContext, datasetId: string) {
  if (datasetId !== owner.datasetId) throw Error('DATASET_CHANGED');
}
async function receiptFacts(scope: ExperienceOpeningReadScope, owner: InternalOwnerContext, receipt: OpeningReceiptRecord) {
  try {
    parseId(receipt.id); parseId(receipt.commandId);
    if (receipt.ownerId !== owner.ownerId || receipt.schemaVersion !== 1 || receipt.commandType !== commandType) throw Error();
    const root = await scope.findExperience(receipt.id);
    if (!root || root.id !== receipt.id || root.createdAt.getTime() !== receipt.createdAt.getTime()) throw Error();
    const data = await openingFacts(scope, owner, root);
    // Reconstruct the accepted canonical input from independent durable facts, not receipt.response.
    const input = parseCreateExperience({
      protocolVersion: 1, datasetId: owner.datasetId, commandId: receipt.commandId,
      storyDraftId: data.story.storyDraftId, expectedStoryRevision: data.story.sourceRevision,
      bindingKey: data.binding.bindingKey, expectedBindingVersion: data.binding.versionNo, budget: data.budget,
    });
    if (receipt.payloadHash !== commandHash(owner, input) || !isDeepStrictEqual(receipt.response, data)) throw Error();
    return data;
  } catch { throw Error('COMMAND_RECEIPT_INVALID'); }
}

export async function createExperience(store: ExperienceOpeningStore, owner: InternalOwnerContext, input: CreateExperience, resolver: BindingResolver, services: RuntimeServices = systemServices): Promise<ExperienceOpeningResult> {
  parseOwner(owner);
  const v = parseCreateExperience(input);
  checkDataset(owner, v.datasetId);
  return store.write(owner.ownerId, async scope => {
    assertOpeningAuthority(scope, owner);
    const prior = await scope.findOpeningReceipt(v.commandId), hash = commandHash(owner, v);
    if (prior) {
      if (prior.commandType !== commandType || prior.payloadHash !== hash) throw Error('IDEMPOTENCY_CONFLICT');
      if (prior.commandId !== v.commandId) throw Error('COMMAND_RECEIPT_INVALID');
      return {data: await receiptFacts(scope, owner, prior), replayed: true};
    }
    const story = await freezeStoryInScope(scope, owner, {
      protocolVersion: v.protocolVersion, datasetId: v.datasetId, storyDraftId: v.storyDraftId,
      expectedRevision: v.expectedStoryRevision,
    }, services);
    const binding = await pinBinding(scope, owner, {bindingKey: v.bindingKey, versionNo: v.expectedBindingVersion}, resolver,
      currentTime(services, new Date(story.sealedAt)), services);
    const now = currentTime(services, new Date(Math.max(Date.parse(story.sealedAt), binding.createdAt.getTime()))),
      id = nextId(services), setupId = nextId(services), draftId = nextId(services);
    const root: ExperienceRecord = {
      id, ownerId: owner.ownerId, storyVersionId: story.id, providerBindingVersionId: binding.id,
      budgetLimitMicros: BigInt(v.budget.limitMicros), budgetCurrency: v.budget.currency,
      status: 'preparing', schedulingPaused: true, dispatchEpoch: 0, revision: 1, rowRevision: 1,
      createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null,
    };
    await scope.insertExperience(root);
    await scope.insertSetup({id: setupId, ownerId: owner.ownerId, experienceId: id, kind: 'setup', experienceRevision: 1,
      options: [], schemaVersion: 1, createdAt: now});
    await scope.insertResponseDraft({id: draftId, ownerId: owner.ownerId, experienceId: id, interactionEventId: setupId,
      text: '', revision: 1, createdAt: now, updatedAt: now});
    const stored = await scope.findExperience(id);
    if (!stored || !isDeepStrictEqual(stored, root)) throw Error('STORED_EXPERIENCE_INVALID');
    await assertStillPreparing(scope, stored);
    const data = await openingFacts(scope, owner, stored);
    await scope.insertOpeningReceipt({id, ownerId: owner.ownerId, commandId: v.commandId, commandType,
      payloadHash: hash, schemaVersion: 1, response: data, createdAt: now});
    const receipt = await scope.findOpeningReceipt(v.commandId);
    if (!receipt || receipt.id !== id) throw Error('COMMAND_RECEIPT_INVALID');
    return {data: await receiptFacts(scope, owner, receipt), replayed: false};
  });
}
export async function getPreparingExperience(store: ExperienceOpeningStore, owner: InternalOwnerContext, input: GetPreparingExperience): Promise<ExperienceOpeningDTO> {
  parseOwner(owner);
  const v = parseGetPreparingExperience(input);
  checkDataset(owner, v.datasetId);
  return store.read(owner.ownerId, async scope => {
    assertOpeningAuthority(scope, owner);
    const root = await scope.findExperience(v.id);
    if (!root || root.deletedAt !== null) throw Error('EXPERIENCE_NOT_FOUND');
    if (root.id !== v.id) throw Error('STORED_EXPERIENCE_INVALID');
    await assertStillPreparing(scope, root);
    const receipt = await scope.findOpeningReceiptById(v.id);
    if (!receipt || receipt.id !== v.id) throw Error('COMMAND_RECEIPT_INVALID');
    return receiptFacts(scope, owner, receipt);
  });
}
