import {createGenerationPlayback} from './generation-playback.js';
import {currentGenerationTurn} from './generation-current.js';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Prisma, type PrismaClient, type GenerationQuote} from '../generated/prisma/client.js';
import {parseGenerationQuote, parseAcceptGeneration, type GenerationQuoteInput, type AcceptGenerationInput, type QuoteDTO, type TurnDTO} from '../contracts/generation.js';
import {parseOwner, parseId} from '../contracts/story-draft-validation.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {parseExecutionProfile} from '../contracts/execution-profile.js';
import type {GenerationPolicy} from '../ports/generation-policy.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {createExperienceOpeningReadScope} from '../infrastructure/db/prisma-experience-opening-store.js';
import {createExecutionProfileWriteScope, createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {openingFacts, assertStillPreparing} from './experience-opening-facts.js';
import {decodeStoredBinding} from './provider-binding-snapshots.js';
import {pinExecutionProfile, readExecutionProfile} from './execution-profiles.js';
import {calculateGenerationCost, type GenerationMeters} from './generation-pricing.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const generationBindingHash = (value: unknown) => hash(canonicalBindingJson(value));
const stages = ['planner', 'video', 'validator'] as const;
type AssetFact = {id: string; sha256: string; revision: number; purpose: string};
type Snapshot = {quote: QuoteDTO; storyHash: string; profileHash: string; assets: AssetFact[]; parentTurnId: string | null; action: string; parentSummary: string; validatorImageLimit: number;
 prices: ReturnType<GenerationPolicy['resolve']>['prices']; meters: Record<typeof stages[number], GenerationMeters>};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const MAX_REVISION = 2147483647;

/** One owner-bound application service. No supplier I/O in the SQLite write gate. */
export function createGenerationService(db: PrismaClient, owner: InternalOwnerContext, authority: LocalStoreAuthority,
 policy: GenerationPolicy, services: RuntimeServices = systemServices) {
 parseOwner(owner); parseId(authority.storeEpoch);
 if (authority.ownerId !== owner.ownerId || authority.datasetId !== owner.datasetId) throw Error('OWNER_UNAVAILABLE');
 const commandHash = (type: string, input: unknown) => hash([type, owner.ownerId, owner.datasetId, input]);
 const dataset = (input: {datasetId: string}) => {if (input.datasetId !== owner.datasetId) throw Error('DATASET_CHANGED');};
 async function replay<T>(tx: Prisma.TransactionClient, type: string, input: {commandId: string}) {
  const receipt = await tx.commandReceipt.findUnique({where: {ownerId_commandId: {ownerId: owner.ownerId, commandId: input.commandId}}});
  if (!receipt) return null;
  if (receipt.commandType !== type || receipt.payloadHash !== commandHash(type, input)) throw Error('IDEMPOTENCY_CONFLICT');
  if (receipt.schemaVersion !== 1) throw Error('COMMAND_RECEIPT_INVALID');
  return receipt.response as T;
 }
 async function saveReceipt(tx: Prisma.TransactionClient, type: string, input: {commandId: string}, response: unknown, now: Date) {
  await tx.commandReceipt.create({data: {id: nextId(services), ownerId: owner.ownerId, commandId: input.commandId,
   commandType: type, payloadHash: commandHash(type, input), response: json(response), schemaVersion: 1, createdAt: now}});
 }
 async function quoteFacts(tx: Prisma.TransactionClient, row: GenerationQuote): Promise<Snapshot> {
  try {
   const snapshot = row.snapshot as unknown as Snapshot, q = snapshot.quote;
   if (row.ownerId !== owner.ownerId || row.datasetId !== owner.datasetId || row.schemaVersion !== 1 ||
    row.contentHash !== hash([row.storeEpoch, row.interactionEventId, snapshot]) || q.protocolVersion !== 1 || q.datasetId !== owner.datasetId ||
    q.id !== row.id || q.experienceId !== row.experienceId || q.experienceRevision !== row.experienceRevision || q.profileId !== row.profileId ||
    q.maxCostMicros !== row.maxCostMicros.toString() || q.currency !== row.currency || q.createdAt !== row.createdAt.toISOString() || q.expiresAt !== row.expiresAt.toISOString()) throw Error();
   const profile = await readExecutionProfile(createExecutionProfileReadScope(tx, owner.ownerId), owner, row.profileId);
   if (profile.contentHash !== snapshot.profileHash) throw Error();
   return snapshot;
  } catch {throw Error('STORED_GENERATION_QUOTE_INVALID');}
 }

 return {
  ...createGenerationPlayback(db, owner, authority, services),
  async quote(input: GenerationQuoteInput): Promise<{data: QuoteDTO; replayed: boolean}> {
   const v = parseGenerationQuote(input); dataset(v); await authority.revalidate();
   return withOwnerWrite(db, owner.ownerId, async tx => {
    const type = 'generation.quote.v1', prior = await replay<QuoteDTO>(tx, type, v);
    if (prior) {
     const stored = await tx.generationQuote.findFirst({where: {id: prior.id, ownerId: owner.ownerId}});
     if (!stored) throw Error('COMMAND_RECEIPT_INVALID');
     const {quote} = await quoteFacts(tx, stored);
     if (!isDeepStrictEqual(quote, prior)) throw Error('COMMAND_RECEIPT_INVALID');
     return {data: quote, replayed: true};
    }
    const scope = createExperienceOpeningReadScope(tx, owner.ownerId), row = await scope.findExperience(v.experienceId);
    if (!row || row.deletedAt || row.archivedAt) throw Error('EXPERIENCE_NOT_FOUND');
    if (row.revision !== v.expectedExperienceRevision) throw Error('REVISION_CONFLICT');
    let parentTurnId: string | null = null, parentSummary = '';
    let interactionEventId: string;
    if (v.kind === 'opening') {
     await assertStillPreparing(scope, row);
     const setup = await scope.findSetup(row.id); if (!setup) throw Error('STORED_EXPERIENCE_INVALID');
     interactionEventId = setup.id;
    } else {
     if (row.status !== 'awaiting' || !row.schedulingPaused) throw Error('GENERATION_NOT_AWAITING');
     const event = await tx.interactionEvent.findFirst({where: {id: v.interactionEventId, ownerId: owner.ownerId, experienceId: row.id, kind: 'decision', experienceRevision: row.revision}});
     const parent = await currentGenerationTurn(tx, owner.datasetId, row);
     if (!event || !parent || parent.status !== 'viewed') throw Error('GENERATION_NOT_AWAITING');
     const result = parent.result as {summary?: unknown};
     if (typeof result?.summary !== 'string') throw Error('GENERATION_CONTENT_UNCONFIRMED');
     parentTurnId = parent.id; parentSummary = result.summary; interactionEventId = event.id;
    }
    const opening = await openingFacts(scope, owner, row), stored = await scope.findBinding(row.providerBindingVersionId);
    if (!stored) throw Error('STORED_PROVIDER_BINDING_INVALID');
    const binding = decodeStoredBinding(stored, owner), {id: _, createdAt: __, ...bindingSpec} = binding;
    // resolve is installed host code: prices, adapter/artifact support cannot come from the caller.
    const evidence = policy.resolve({binding, story: opening.story}), spec = parseExecutionProfile(evidence.profile);
    if (!Number.isSafeInteger(evidence.validatorImageLimit) || evidence.validatorImageLimit < 1 || evidence.validatorImageLimit > 16 || evidence.artifactsReady !== true || !['native', 'silent'].includes(evidence.audio) || !isDeepStrictEqual(spec.video.binding, bindingSpec) || spec.currency !== row.budgetCurrency)
     throw Error('GENERATION_POLICY_UNAVAILABLE');
    const now = currentTime(services, row.createdAt);
    const assets: AssetFact[] = [];
    for (const [purpose, id] of [['opening', opening.story.assetSlots.opening], ['character', opening.story.assetSlots.character],
     ['portrait', opening.story.mainCharacter?.effective.portraitAssetId]] as const) {
     if (!id) continue;
     const asset = await scope.findAsset(id);
     if (!asset || asset.ownerId !== owner.ownerId || asset.deletedAt || asset.status !== 'ready') throw Error('STORY_ASSET_NOT_READY');
     assets.push({id, sha256: asset.sha256, revision: asset.revision, purpose});
    }
    const imageCount = new Set(assets.map(asset => asset.id)).size, g = spec.video.binding.parameters.generation;
    const textMeters = (stage: 'planner' | 'validator'): GenerationMeters => ({kind: 'text',
     inputTokens: spec[stage].binding.parameters.generation.maxInputTokens, outputTokens: spec[stage].binding.parameters.generation.maxOutputTokens,
     images: imageCount + (stage === 'validator' ? evidence.validatorImageLimit : 0), maxCalls: spec[stage].maxCalls});
    if (typeof g.duration !== 'number' || typeof g.resolution !== 'string' || typeof g.ratio !== 'string') throw Error('GENERATION_POLICY_UNAVAILABLE');
    const meters: Snapshot['meters'] = {planner: textMeters('planner'), validator: textMeters('validator'),
     video: {kind: 'video', seconds: g.duration, images: imageCount, maxCalls: 1}};
    let total = 0n, validUntil = now.getTime() + 5 * 60000;
    for (const stage of stages) {
     const price = evidence.prices[stage];
     if (!price || price.bindingHash !== generationBindingHash(spec[stage].binding)) throw Error('GENERATION_PRICE_UNAVAILABLE');
     const cost = calculateGenerationCost(price, meters[stage], spec.currency, now);
     if (cost > BigInt(spec[stage].maxCostMicros)) throw Error('GENERATION_STAGE_BUDGET_EXCEEDED');
     total += cost; validUntil = Math.min(validUntil, Date.parse(price.validUntil));
    }
    if (total > row.budgetLimitMicros || total > 9223372036854775807n) throw Error('GENERATION_BUDGET_EXCEEDED');
    const profile = await pinExecutionProfile(createExecutionProfileWriteScope(tx, owner.ownerId), owner, spec, services);
    const quote: QuoteDTO = {protocolVersion: 1, datasetId: owner.datasetId, id: nextId(services), experienceId: row.id,
     experienceRevision: row.revision, profileId: profile.id, maxCostMicros: total.toString(), currency: spec.currency,
     createdAt: now.toISOString(), expiresAt: new Date(validUntil).toISOString(), summary: {
      title: opening.story.title, prompt: v.kind === 'response' ? v.text : opening.story.settings.opening, modelId: binding.modelId, region: binding.parameters.region,
      duration: g.duration, resolution: g.resolution, ratio: g.ratio, audio: evidence.audio, inputAssetIds: [...new Set(assets.map(a => a.id))]}};
    const snapshot: Snapshot = {quote, storyHash: opening.story.contentHash, profileHash: profile.contentHash, assets, parentTurnId, action: v.kind === 'response' ? v.text : '', parentSummary, validatorImageLimit: evidence.validatorImageLimit,
     prices: structuredClone(evidence.prices), meters};
    await tx.generationQuote.create({data: {id: quote.id, ownerId: owner.ownerId, datasetId: owner.datasetId, storeEpoch: authority.storeEpoch,
     experienceId: row.id, experienceRevision: row.revision, interactionEventId, profileId: profile.id,
     maxCostMicros: total, currency: spec.currency, snapshot: json(snapshot), contentHash: hash([authority.storeEpoch, interactionEventId, snapshot]),
     createdAt: now, expiresAt: new Date(validUntil)}});
    await saveReceipt(tx, type, v, quote, now);
    return {data: quote, replayed: false};
   });
  },
  async accept(input: AcceptGenerationInput): Promise<{data: TurnDTO; replayed: boolean}> {
   const v = parseAcceptGeneration(input); dataset(v); await authority.revalidate();
   return withOwnerWrite(db, owner.ownerId, async tx => {
    const type = 'generation.accept.v1', prior = await replay<TurnDTO>(tx, type, v);
    if (prior) {
     const turn = await tx.generationTurn.findFirst({where: {id: prior.id, ownerId: owner.ownerId, quoteId: v.quoteId, experienceId: v.experienceId}});
     if (!turn || !isDeepStrictEqual(prior, {protocolVersion: 1, datasetId: owner.datasetId, id: turn.id, experienceId: turn.experienceId,
      quoteId: turn.quoteId, status: 'queued', createdAt: turn.createdAt.toISOString()})) throw Error('COMMAND_RECEIPT_INVALID');
     return {data: prior, replayed: true};
    }
    const q = await tx.generationQuote.findFirst({where: {id: v.quoteId, ownerId: owner.ownerId, experienceId: v.experienceId}});
    if (!q) throw Error('GENERATION_QUOTE_NOT_FOUND');
    const snapshot = await quoteFacts(tx, q), now = currentTime(services);
    if (q.storeEpoch !== authority.storeEpoch) throw Error('GENERATION_QUOTE_STALE');
    if (q.expiresAt <= now || now < q.createdAt) throw Error('GENERATION_QUOTE_EXPIRED');
    if (q.acceptedTurnId) throw Error('GENERATION_QUOTE_CONSUMED');
    if (q.experienceRevision !== v.expectedExperienceRevision) throw Error('REVISION_CONFLICT');
    const scope = createExperienceOpeningReadScope(tx, owner.ownerId), root = await tx.experience.findFirst({where: {id: v.experienceId, ownerId: owner.ownerId}});
    if (!root || root.deletedAt || root.archivedAt) throw Error('EXPERIENCE_NOT_FOUND');
    if (root.revision !== v.expectedExperienceRevision) throw Error('REVISION_CONFLICT');
    if (root.revision >= MAX_REVISION || root.rowRevision >= MAX_REVISION || root.dispatchEpoch >= MAX_REVISION) throw Error('REVISION_EXHAUSTED');
    if (snapshot.parentTurnId) {
     if (root.status !== 'awaiting' || !root.schedulingPaused) throw Error('GENERATION_NOT_AWAITING');
     const event = await tx.interactionEvent.findFirst({where: {id: q.interactionEventId, ownerId: owner.ownerId, experienceId: root.id, kind: 'decision', experienceRevision: root.revision}});
     const parent = await currentGenerationTurn(tx, owner.datasetId, root);
     if (!event || !parent || parent.id !== snapshot.parentTurnId || parent.status !== 'viewed') throw Error('GENERATION_NOT_AWAITING');
    } else await assertStillPreparing(scope, root);
    const opening = await openingFacts(scope, owner, root);
    if (opening.story.contentHash !== snapshot.storyHash || (!snapshot.parentTurnId && opening.setup.id !== q.interactionEventId)) throw Error('GENERATION_QUOTE_STALE');
    for (const expected of snapshot.assets) {
     const asset = await scope.findAsset(expected.id);
     if (!asset || asset.ownerId !== owner.ownerId || asset.deletedAt || asset.status !== 'ready' || asset.sha256 !== expected.sha256 || asset.revision !== expected.revision)
      throw Error('STORY_ASSET_NOT_READY');
    }
    // Root scope persists across later forks. First paid intent creates it; preparation spends nothing.
    const scopeId = root.budgetScopeId ?? nextId(services);
    if (!root.budgetScopeId) await tx.budgetScope.create({data: {id: scopeId, ownerId: owner.ownerId, limitMicros: root.budgetLimitMicros, currency: root.budgetCurrency, createdAt: now}});
    const budget = await tx.budgetScope.findFirst({where: {id: scopeId, ownerId: owner.ownerId}});
    if (!budget || budget.currency !== q.currency || root.budgetCurrency !== q.currency) throw Error('GENERATION_BUDGET_INVALID');
    // Unknown outcomes remain reserved. A reservation may only be released by definitive settlement.
    async function liability(where: Prisma.BudgetReservationWhereInput) {
     const rows = await tx.budgetReservation.findMany({where});
     let sum = 0n;
     for (const r of rows) {
      if (r.ownerId !== owner.ownerId || r.currency !== q!.currency || r.reservedMicros < 0n || r.settledMicros < 0n || !['held', 'settled', 'released'].includes(r.status)) throw Error('GENERATION_BUDGET_INVALID');
      sum += r.status === 'held' ? r.reservedMicros + r.settledMicros : r.settledMicros;
     }
     return sum;
    }
    if (await liability({budgetScopeId: scopeId}) + q.maxCostMicros > budget.limitMicros ||
     await liability({ownerId: owner.ownerId, experienceId: root.id}) + q.maxCostMicros > root.budgetLimitMicros) throw Error('GENERATION_BUDGET_EXCEEDED');
    const id = nextId(services), data: TurnDTO = {protocolVersion: 1, datasetId: owner.datasetId, id, experienceId: root.id, quoteId: q.id, status: 'queued', createdAt: now.toISOString()};
    const consumed = await tx.generationQuote.updateMany({where: {id: q.id, ownerId: owner.ownerId, acceptedTurnId: null}, data: {acceptedTurnId: id}});
    if (consumed.count !== 1) throw Error('GENERATION_QUOTE_CONSUMED');
    const changed = await tx.experience.updateMany({where: {id: root.id, ownerId: owner.ownerId, revision: root.revision, rowRevision: root.rowRevision, status: root.status},
     data: {budgetScopeId: scopeId, status: 'generating', schedulingPaused: false, revision: {increment: 1}, rowRevision: {increment: 1}, dispatchEpoch: {increment: 1}, updatedAt: now}});
    if (changed.count !== 1) throw Error('REVISION_CONFLICT');
    await tx.generationTurn.create({data: {id, ownerId: owner.ownerId, experienceId: root.id, budgetScopeId: scopeId, quoteId: q.id,
     interactionEventId: q.interactionEventId, parentTurnId: snapshot.parentTurnId, status: 'queued', createdAt: now, updatedAt: now}});
    await tx.budgetReservation.create({data: {id, ownerId: owner.ownerId, experienceId: root.id, budgetScopeId: scopeId, reservedMicros: q.maxCostMicros,
     settledMicros: 0n, currency: q.currency, status: 'held', createdAt: now, updatedAt: now}});
    await tx.runtimeOutbox.create({data: {id, ownerId: owner.ownerId, kind: 'generation.start', status: 'pending', availableAt: now, createdAt: now, updatedAt: now}});
    await saveReceipt(tx, type, v, data, now);
    return {data, replayed: false};
   });
  },
 };
}
