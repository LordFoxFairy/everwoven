import {beforeAll, afterAll, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from './fixtures/story-aggregate/setup.js';
import {createVideoBindingRegistry} from '../src/application/video-binding-registry.js';
import {createExperienceOpeningService} from '../src/composition/experience-opening-service.js';
import {createGenerationService, generationBindingHash} from '../src/application/generation.js';
import {parseExecutionProfile} from '../src/contracts/execution-profile.js';
import type {GenerationPolicy, StagePrice} from '../src/ports/generation-policy.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
beforeAll(prepare); afterAll(dispose);
import {setup} from './fixtures/generation/setup.js';
it('quotes all three bounded stages with zero tasks/charges, then atomically reserves and enqueues once', async () => {
 const f = await setup(); const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 try {
  const quote = await f.generation.quote(f.quoteInput);
  expect(quote.data).toMatchObject({maxCostMicros: '10755', summary: {title: '雨后的天台', duration: 5, modelId: 'MiniMax-H3-Max', ratio: '16:9'}});
  expect(await f.db.generationTurn.count()).toBe(0); expect(await f.db.budgetScope.count()).toBe(0);
  const input = f.acceptInput(quote.data.id), turn = await f.generation.accept(input);
  expect(turn.data.status).toBe('queued'); expect(await f.generation.accept(input)).toEqual({...turn, replayed: true});
  expect(await f.db.generationTurn.count()).toBe(1); expect(await f.db.runtimeOutbox.count()).toBe(1);
  expect(await f.db.budgetReservation.findUnique({where: {id: turn.data.id}})).toMatchObject({reservedMicros: 10755n, settledMicros: 0n, status: 'held'});
  expect(await f.db.experience.findUnique({where: {id: f.opening.id}})).toMatchObject({status: 'generating', revision: 2, dispatchEpoch: 1, schedulingPaused: false});
  expect(fetch).not.toHaveBeenCalled();
 } finally {fetch.mockRestore(); await f.close();}
});
it('does not reprice or extend an old quote on replay; expiry prohibits a new acceptance', async () => {
 const f = await setup();
 try {
  const quote = await f.generation.quote(f.quoteInput); f.tick(300001); f.policy.resolve.mockImplementation(() => {throw Error('UNCONFIGURED');});
  expect(await f.generation.quote(f.quoteInput)).toEqual({...quote, replayed: true});
  await expect(f.generation.accept(f.acceptInput(quote.data.id))).rejects.toThrow('GENERATION_QUOTE_EXPIRED');
  expect(await f.db.runtimeOutbox.count()).toBe(0);
 } finally {await f.close();}
});
it('a second command cannot consume one quote twice, and a different quote cannot start the same revision', async () => {
 const f = await setup();
 try {
  const a = await f.generation.quote(f.quoteInput), b = await f.generation.quote({...f.quoteInput, commandId: v7()});
  const outcomes = await Promise.allSettled([f.generation.accept(f.acceptInput(a.data.id)), f.generation.accept(f.acceptInput(a.data.id))]);
  expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  await expect(f.generation.accept(f.acceptInput(b.data.id))).rejects.toThrow('REVISION_CONFLICT');
  expect(await f.db.generationTurn.count()).toBe(1); expect(await f.db.budgetReservation.count()).toBe(1);
 } finally {await f.close();}
});
it('rolls back root, quote consumption, budget and turn if writing the outbox fails', async () => {
 const f = await setup();
 try {
  const quote = await f.generation.quote(f.quoteInput), occupiedId = v7();
  await f.db.runtimeOutbox.create({data: {id: occupiedId, ownerId: f.owner.ownerId, kind: 'test-fixture', status: 'pending', availableAt: f.now, createdAt: f.now, updatedAt: f.now}});
  const ids = [v7(), occupiedId];
  const broken = createGenerationService(f.db, f.owner, f.authority, f.policy, {...f.services, ids: {next: () => ids.shift() ?? v7()}});
  await expect(broken.accept(f.acceptInput(quote.data.id))).rejects.toThrow();
  expect(await f.db.budgetScope.count()).toBe(0); expect(await f.db.generationTurn.count()).toBe(0); expect(await f.db.budgetReservation.count()).toBe(0);
  expect((await f.db.generationQuote.findUniqueOrThrow({where: {id: quote.data.id}})).acceptedTurnId).toBeNull();
  expect((await f.db.experience.findUniqueOrThrow({where: {id: f.opening.id}})).status).toBe('preparing');
 } finally {await f.close();}
});
it('reopens accepted facts without present policy and without another wake or budget reservation', async () => {
 const f = await setup(); let reopened: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
 try {
  const quote = await f.generation.quote(f.quoteInput), input = f.acceptInput(quote.data.id), first = await f.generation.accept(input);
  const files = await f.db.$queryRawUnsafe<Array<{file: string}>>('PRAGMA database_list');
  const file = files[0]!.file;
  await f.db.$disconnect(); reopened = await openRuntimeDatabase(file!);
  f.policy.resolve.mockImplementation(() => {throw Error('UNCONFIGURED');}); f.tick(3600000);
  const service = createGenerationService(reopened, f.owner, f.authority, f.policy, f.services);
  expect(await service.accept(input)).toEqual({...first, replayed: true});
  expect(await reopened.runtimeOutbox.count()).toBe(1); expect(await reopened.budgetReservation.count()).toBe(1);
 } finally {await reopened?.$disconnect(); await f.close();}
});
it('retains unknown liability across branches and enforces the shared root budget', async () => {
 const f = await setup('20000');
 try {
  const quote = await f.generation.quote(f.quoteInput), scopeId = v7();
  await f.db.budgetScope.create({data: {id: scopeId, ownerId: f.owner.ownerId, limitMicros: 20000n, currency: 'USD', createdAt: f.now}});
  await f.db.experience.update({where: {id: f.opening.id}, data: {budgetScopeId: scopeId}});
  await f.db.budgetReservation.create({data: {id: v7(), ownerId: f.owner.ownerId, experienceId: v7(), budgetScopeId: scopeId,
   reservedMicros: 10000n, settledMicros: 0n, currency: 'USD', status: 'held', createdAt: f.now, updatedAt: f.now}});
  await expect(f.generation.accept(f.acceptInput(quote.data.id))).rejects.toThrow('GENERATION_BUDGET_EXCEEDED');
  expect(await f.db.generationTurn.count()).toBe(0);
 } finally {await f.close();}
});
it('rejects authority/dataset drift, missing consent and conflicting idempotency payloads', async () => {
 const f = await setup();
 try {
  const quote = await f.generation.quote(f.quoteInput), input = f.acceptInput(quote.data.id);
  await expect(f.generation.accept({...input, consent: false} as never)).rejects.toThrow('INVALID_GENERATION_COMMAND');
  await expect(f.generation.quote({...f.quoteInput, datasetId: v7()})).rejects.toThrow('DATASET_CHANGED');
  await expect(f.generation.quote({...f.quoteInput, experienceId: v7()})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const otherEpoch = createGenerationService(f.db, f.owner, {...f.authority, storeEpoch: v7()}, f.policy, f.services);
  await expect(otherEpoch.accept(input)).rejects.toThrow('GENERATION_QUOTE_STALE');
  f.authority.revalidate.mockRejectedValueOnce(Error('STORE_AUTHORITY_UNAVAILABLE'));
  await expect(f.generation.accept(input)).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
  expect(await f.db.generationTurn.count()).toBe(0);
 } finally {await f.close();}
});
it.each(['price', 'identity', 'artifact', 'limit'] as const)('rejects incomplete %s evidence before persisting profile/quote', async kind => {
 const f = await setup();
 try {
  if (kind === 'price') f.evidence.prices.video.validUntil = '2000-01-01T00:00:00.000Z';
  if (kind === 'identity') f.evidence.prices.video.bindingHash = 'f'.repeat(64);
  if (kind === 'artifact') Object.assign(f.evidence, {artifactsReady: false});
  if (kind === 'limit') f.evidence.profile.video.maxCostMicros = '1';
  await expect(f.generation.quote(f.quoteInput)).rejects.toThrow();
  expect(await f.db.executionProfileVersion.count()).toBe(0); expect(await f.db.generationQuote.count()).toBe(0);
 } finally {await f.close();}
});
it('pins explicit private references and rechecks image availability before acceptance', async () => {
 const f = await setup('1000000', true);
 try {
  const q = await f.generation.quote(f.quoteInput);
  expect(q.data.summary.inputAssetIds).toEqual([f.image!.id]); expect(q.data.maxCostMicros).toBe('10770');
  await f.db.asset.update({where: {id: f.image!.id}, data: {deletedAt: new Date()}});
  await expect(f.generation.accept(f.acceptInput(q.data.id))).rejects.toThrow();
  expect(await f.db.generationTurn.count()).toBe(0);
 } finally {await f.close();}
});
it('dispatch readiness blocks all new budget/outbox writes but never breaks accepted receipt recovery',async()=>{
 const f=await setup();
 try{
  const quote=await f.generation.quote(f.quoteInput),input=f.acceptInput(quote.data.id);
  f.policy.assertDispatch.mockImplementation(()=>{throw Error('GENERATION_RUNTIME_UNAVAILABLE');});
  await expect(f.generation.accept(input)).rejects.toThrow('GENERATION_RUNTIME_UNAVAILABLE');
  expect(await f.db.budgetReservation.count()).toBe(0);expect(await f.db.runtimeOutbox.count()).toBe(0);
  f.policy.assertDispatch.mockImplementation(()=>{});const accepted=await f.generation.accept(input);
  f.policy.assertDispatch.mockImplementation(()=>{throw Error('GENERATION_RUNTIME_UNAVAILABLE');});
  expect(await f.generation.accept(input)).toEqual({...accepted,replayed:true});
  expect((await f.generation.getQuote({...f.protocol,experienceId:f.opening.id,quoteId:quote.data.id})).acceptedTurnId).toBe(accepted.data.id);
 }finally{await f.close();}
});
