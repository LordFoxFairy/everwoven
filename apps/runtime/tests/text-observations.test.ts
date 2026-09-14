import {beforeAll, afterAll, afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {createTextObservationRecorder} from '../src/application/text-observations.js';
import {createGenerationWorker, type GenerationContext} from '../src/application/generation-worker.js';
import {createPersistedGenerationExecutor} from '../src/composition/generation-executor.js';
import {sceneArtifacts} from '../src/application/scene-artifacts.js';
import {readExecutionProfile} from '../src/application/execution-profiles.js';
import {createExecutionProfileReadScope} from '../src/infrastructure/db/prisma-execution-profile-store.js';
import {generationBindingHash} from '../src/application/generation.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import type {TextObservation} from '../src/ports/structured-text.js';
beforeAll(prepare);afterAll(dispose);afterEach(() => vi.restoreAllMocks());
async function fixture(lease = true) {
 const f = await setup(), artifacts = sceneArtifacts();
 Object.assign(f.evidence.profile, {graph: artifacts.graph});Object.assign(f.evidence.profile.planner, artifacts.planner);Object.assign(f.evidence.profile.validator, artifacts.validator);
 const quote = (await f.generation.quote(f.quoteInput)).data, turn = (await f.generation.accept(f.acceptInput(quote.id))).data;
 const profile = await readExecutionProfile(createExecutionProfileReadScope(f.db, f.owner.ownerId), f.owner, quote.profileId);
 const context: GenerationContext = {turnId: turn.id, story: f.opening.story, profile, quote, action: '', parentSummary: '', validatorImageLimit: 3};
 const observation: TextObservation = {providerId: profile.snapshot.planner.binding.providerId, modelId: profile.snapshot.planner.binding.modelId,
  bindingHash: generationBindingHash(profile.snapshot.planner.binding), responseId: 'fixture-response', usage: {inputTokens: 20, outputTokens: 10, totalTokens: 30}};
 if (lease) {
  await f.db.generationTurn.update({where: {id: turn.id}, data: {status: 'planning'}});
  await f.db.runtimeOutbox.update({where: {id: turn.id}, data: {status: 'leased', leaseToken: v7(), leaseUntil: new Date(f.services.clock.now().getTime() + 120000)}});
 }
 return {...f, quote, turn, context, observation, record: createTextObservationRecorder(f.db, f.owner, f.authority, f.services)};
}
it('durably records only normalized usage, replays concurrently and after reconnect without a second row', async () => {
 const f = await fixture();let reopened: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
 try {
  await Promise.all([f.record(f.context, 'planner', f.observation), f.record(f.context, 'planner', f.observation)]);
  const row = await f.db.textUsageObservation.findFirstOrThrow();
  expect(row).toMatchObject({ownerId: f.owner.ownerId, datasetId: f.owner.datasetId, storeEpoch: f.authority.storeEpoch,
   turnId: f.turn.id, quoteId: f.quote.id, profileId: f.context.profile.id, stage: 'planner', observation: f.observation});
  expect(JSON.stringify(row)).not.toContain('credentialRef');expect(JSON.stringify(row)).not.toContain('world');
  await f.db.generationTurn.update({where: {id: f.turn.id}, data: {status: 'prepared'}});
  await f.db.runtimeOutbox.update({where: {id: f.turn.id}, data: {status: 'pending', leaseToken: null, leaseUntil: null}});
  const files = await f.db.$queryRawUnsafe<Array<{file: string}>>('PRAGMA database_list');await f.db.$disconnect();
  reopened = await openRuntimeDatabase(files[0]!.file);
  await createTextObservationRecorder(reopened, f.owner, f.authority, f.services)(f.context, 'planner', f.observation);
  expect(await reopened.textUsageObservation.findMany()).toEqual([row]);
 } finally {await reopened?.$disconnect();await f.close();}
});
it('preserves missing usage and rejects conflicting response IDs or counts without overwriting the first observation', async () => {
 const f = await fixture();
 try {
  f.observation.usage = {};await f.record(f.context, 'planner', f.observation);
  for (const changed of [{...f.observation, responseId: 'different'}, {...f.observation, usage: {inputTokens: 1}}])
   await expect(f.record(f.context, 'planner', changed)).rejects.toThrow('TEXT_OBSERVATION_CONFLICT');
  expect((await f.db.textUsageObservation.findFirstOrThrow()).observation).toEqual(f.observation);
  expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held', settledMicros: 0n});
 } finally {await f.close();}
});
it.each(['negative', 'fraction', 'unsafe', 'extra', 'binding', 'model', 'response'])('rejects invalid %s observation before inserting', async kind => {
 const f = await fixture();
 try {
  if (kind === 'negative') f.observation.usage.inputTokens = -1;
  if (kind === 'fraction') f.observation.usage.inputTokens = 0.5;
  if (kind === 'unsafe') f.observation.usage.inputTokens = Number.MAX_SAFE_INTEGER + 1;
  if (kind === 'extra') Object.assign(f.observation, {rawResponse: 'private text'});
  if (kind === 'binding') f.observation.bindingHash = 'c'.repeat(64);
  if (kind === 'model') f.observation.modelId = 'other-model';
  if (kind === 'response') f.observation.responseId = 'bad\nresponse';
  await expect(f.record(f.context, 'planner', f.observation)).rejects.toThrow();
  expect(await f.db.textUsageObservation.count()).toBe(0);
 } finally {await f.close();}
});
it.each(['dataset', 'epoch', 'quote', 'profile', 'turn', 'stage', 'unleased', 'expired'])('rejects mismatched %s execution authority', async kind => {
 const f = await fixture();
 try {
  if (kind === 'dataset') f.context.quote.datasetId = v7();
  if (kind === 'epoch') f.authority.storeEpoch = v7();
  if (kind === 'quote') f.context.quote.maxCostMicros = '1';
  if (kind === 'profile') f.context.profile.snapshot.planner.binding.modelId = 'changed';
  if (kind === 'turn') f.context.turnId = v7();
  if (kind === 'stage') await f.db.generationTurn.update({where: {id: f.turn.id}, data: {status: 'unknown'}});
  if (kind === 'unleased') await f.db.runtimeOutbox.update({where: {id: f.turn.id}, data: {status: 'pending'}});
  if (kind === 'expired') f.tick(120001);
  await expect(f.record(f.context, 'planner', f.observation)).rejects.toThrow();expect(await f.db.textUsageObservation.count()).toBe(0);
 } finally {await f.close();}
});
it('rejects a modified saved observation on replay', async () => {
 const f = await fixture();
 try {
  await f.record(f.context, 'planner', f.observation);
  await f.db.textUsageObservation.updateMany({data: {contentHash: '0'.repeat(64)}});
  await expect(f.record(f.context, 'planner', f.observation)).rejects.toThrow('STORED_TEXT_OBSERVATION_INVALID');
 } finally {await f.close();}
});
it('rolls back insertion if cancellation arrives during the transaction', async () => {
 const f = await fixture(), abort = new AbortController();
 try {
  const extended = f.db.$extends({query: {textUsageObservation: {async create({args, query}) {const value = await query(args);abort.abort();return value;}}}});
  await expect(createTextObservationRecorder(extended as unknown as typeof f.db, f.owner, f.authority, f.services)(f.context, 'planner', f.observation, abort.signal)).rejects.toThrow();
  expect(await f.db.textUsageObservation.count()).toBe(0);
 } finally {await f.close();}
});
it.each(['confirmed', 'unconfirmed', 'write-failure'])('installs real observation persistence in the Worker director (%s)', async result => {
 const f = await fixture(false);
 try {
  const media = {id: v7(), sha256: 'b'.repeat(64), duration: 5};
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => Response.json(init?.method === 'POST' ? {task_id: 'fixture-task'} : {
   task: {id: 'fixture-task', model: 'MiniMax-H3-Max', status: 'succeeded', task_type: 'generation', modality: 'video', ratio: '16:9', resolution: '768P', duration: 5, content: {url: 'https://fixture.example/video'}}}));
  const invoke = vi.fn(async (binding: typeof f.context.profile.snapshot.planner.binding) => ({
   value: binding.bindingKey === 'planner' ? {prompt: '角色走到窗边。'} : {verdict: result === 'unconfirmed' ? 'uncertain' : 'confirmed', summary: '角色站在窗边。',
    choices: [{id: 'ask', title: '询问', text: '你在看什么？'}, {id: 'look', title: '看看', text: '我看看窗外。'}], evidenceFrameIndices: [0]},
   observation: {...f.observation, bindingHash: generationBindingHash(binding), responseId: `fixture-${binding.bindingKey}`},
  }));
  const observationDB = result === 'write-failure' ? f.db.$extends({query: {textUsageObservation: {async create() {throw Error('FIXTURE_DISK_FAILURE');}}}}) : f.db;
  const executor = createPersistedGenerationExecutor(observationDB as typeof f.db, f.owner, f.authority, {
   text: binding => ({bindingHash: generationBindingHash(binding), invoke: async () => invoke(binding)}), assertVideoProfile() {},
   jobs: binding => createMiniMaxVideoJobs(binding, {apiKey: 'TEST_ONLY', fetchImpl}), materialize: async () => media,
   sample: async () => ({mediaId: media.id, mediaSha256: media.sha256, frames: [{atMs: 0, jpeg: Uint8Array.from([255, 216, 255, 217])}]}),
  }, f.services);
  const worker = createGenerationWorker(f.db, f.owner, f.authority, executor, f.services);
  for (let i = 0; i < 5; i++) await worker.tick();
  expect(await f.db.textUsageObservation.count()).toBe(result === 'write-failure' ? 0 : 2);
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: result === 'confirmed' ? 'ready' : 'unknown'});
  expect(await f.db.interactionEvent.count({where: {kind: 'decision'}})).toBe(0);
  expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held', settledMicros: 0n});
  expect(await worker.tick()).toBe(false);expect(invoke).toHaveBeenCalledTimes(result === 'write-failure' ? 1 : 2);
 } finally {await f.close();}
});
