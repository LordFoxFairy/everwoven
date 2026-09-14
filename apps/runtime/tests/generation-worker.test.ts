import {beforeAll, afterAll, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {createGenerationWorker, type GenerationExecutor} from '../src/application/generation-worker.js';
import {generationBindingHash} from '../src/application/generation.js';
import type {BindingSpec} from '../src/contracts/provider-binding.js';
import type {VideoTaskReference, PreparedVideoInput} from '../src/ports/video-jobs.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import {createGenerationPlayback} from '../src/application/generation-playback.js';
import {lstat, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createPrivateVideoStore} from '../src/infrastructure/media/private-video-store.js';
beforeAll(prepare); afterAll(dispose);
it.each(['fields', 'json', 'utf8'])('blocks actual malformed %s recovery hint before any download', async kind => {
 const f = await workerFixture(), source = {open: vi.fn(async () => {throw Error('DOWNLOAD_MUST_NOT_RUN');})};
 try {
  const rows = await f.db.$queryRawUnsafe<Array<{file: string}>>('PRAGMA database_list'), directory = dirname(rows[0]!.file), parent = dirname(directory);
  const store = await createPrivateVideoStore({target: {directory, parent, parentIdentity: await lstat(parent)}, identity: await lstat(directory),
   manifest: {version: 1, ...f.owner, environment: 'dev', createdAt: new Date().toISOString()}}, f.owner,
   {source, probe: async () => {throw Error('PROBE_MUST_NOT_RUN');}, revalidate: async () => {}});
  f.executor.materialize = vi.fn(async (context, video) => {
   const sourceHash = createHash('sha256').update(JSON.stringify([context.turnId, video])).digest('hex');
   await writeFile(join(directory, 'assets', f.owner.datasetId, `.video-${context.turnId}-${sourceHash}.json`),
    kind === 'utf8' ? Buffer.from([0xff, 0xff]) : kind === 'json' ? '{!' : '{}', {mode: 0o600});
   return store.materialize(context.turnId, video);
  });
  for (let i = 0; i < 4; i++) await f.worker.tick();
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown'});
  expect(await f.db.runtimeOutbox.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'blocked'});
  expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held'});
  f.tick(60000);expect(await f.worker.tick()).toBe(false);expect(source.open).not.toHaveBeenCalled();expect(f.executor.materialize).toHaveBeenCalledOnce();
 } finally {await f.close();}
});
it.each(['VIDEO_CONTENT_INVALID', 'VIDEO_DIMENSIONS_UNAVAILABLE', 'PRIVATE_VIDEO_CACHE_INVALID', 'VIDEO_DOWNLOAD_SOURCE_DENIED'])('blocks permanent media failure %s and preserves the paid reservation without repeated downloads', async code => {
 const f = await workerFixture();
 try {
  f.executor.materialize = vi.fn(async () => {throw Error(code);});
  await f.worker.tick();await f.worker.tick();await f.worker.tick();await f.worker.tick();
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown', errorCode: 'GENERATION_RESULT_UNKNOWN'});
  expect(await f.db.runtimeOutbox.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'blocked'});
  expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held'});
  f.tick(60000);expect(await f.worker.tick()).toBe(false);expect(f.executor.materialize).toHaveBeenCalledOnce();
 } finally {await f.close();}
});
async function workerFixture(customizeVideo?: (binding: BindingSpec) => BindingSpec) {
 const f = await setup(undefined, false, customizeVideo), quote = await f.generation.quote(f.quoteInput), accepted = await f.generation.accept(f.acceptInput(quote.data.id));
 const transport = vi.fn<typeof fetch>(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST' ? {task_id: 'fixture-task'} : {
  task: {id: 'fixture-task', model: 'MiniMax-H3-Max', status: 'succeeded', task_type: 'generation', modality: 'video',
   ratio: '16:9', resolution: '768P', duration: 5, content: {url: 'https://media.example/fixture.mp4'}}})));
 const executor: GenerationExecutor = {
  assertProfile: vi.fn(() => {}),
  plan: vi.fn(async () => ({prompt: '雨后的天台，两人望向天空。'})),
  jobs: binding => createMiniMaxVideoJobs(binding, {apiKey: 'TEST_ONLY', fetchImpl: transport}),
  materialize: vi.fn(async () => ({id: v7(), sha256: 'a'.repeat(64), duration: 5})),
  validate: vi.fn(async () => ({summary: '两人在天台望向天空。', choices: [{id: 'ask', title: '问问对方', text: '你在看什么？'}, {id: 'watch', title: '一起看看', text: '我顺着他的视线看向天空。'}]})),
 };
 const worker = createGenerationWorker(f.db, f.owner, f.authority, executor, f.services);
 return {...f, quote: quote.data, turn: accepted.data, executor, transport, worker};
}
it('persists each real adapter step before playback, reserves cost, and stops without automatically continuing', async () => {
 const f = await workerFixture();
 try {
  for (const status of ['prepared', 'polling', 'materializing', 'checking', 'ready']) {
   expect(await f.worker.tick()).toBe(true);
   expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}})).status).toBe(status);
  }
  expect(await f.worker.tick()).toBe(false);
  const row = await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}});
  expect(row.providerReference).toMatchObject({operationId: f.turn.id, taskId: 'fixture-task'});
  expect(row.result).toMatchObject({summary: '两人在天台望向天空。'});
  expect((await f.db.experience.findUniqueOrThrow({where: {id: f.opening.id}})).status).toBe('playing');
  expect(await f.db.interactionEvent.count()).toBe(1); // No decision until playback acknowledgement.
  expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held', reservedMicros: 10755n});
  expect(f.transport.mock.calls.filter(x => x[1]?.method === 'POST')).toHaveLength(1);
  expect(f.executor.plan).toHaveBeenCalledTimes(1); expect(f.executor.validate).toHaveBeenCalledTimes(1);
 } finally {await f.close();}
});
it('restarts after a saved supplier receipt by querying the same task, with no second POST', async () => {
 const f = await workerFixture(); let reopened: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
 try {
  await f.worker.tick(); await f.worker.tick();
  const files = await f.db.$queryRawUnsafe<Array<{file: string}>>('PRAGMA database_list'); await f.db.$disconnect();
  reopened = await openRuntimeDatabase(files[0]!.file);
  const worker = createGenerationWorker(reopened, f.owner, f.authority, f.executor, f.services);
  await worker.tick(); await worker.tick(); await worker.tick();
  expect((await reopened.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}})).status).toBe('ready');
  expect(f.transport.mock.calls.filter(x => x[1]?.method === 'POST')).toHaveLength(1);
  expect(f.executor.plan).toHaveBeenCalledTimes(1);
 } finally {await reopened?.$disconnect(); await f.close();}
});
it('retains an ambiguous submission without automatically repeating a paid request', async () => {
 const f = await workerFixture();
 try {
  await f.worker.tick(); f.transport.mockRejectedValueOnce(Error('connection lost after acceptance'));
  await f.worker.tick(); expect(await f.worker.tick()).toBe(false);
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown', providerReference: null});
  expect((await f.db.budgetReservation.findUniqueOrThrow({where: {id: f.turn.id}})).reservedMicros).toBe(10755n);
  expect(f.transport).toHaveBeenCalledTimes(1);
 } finally {await f.close();}
});
it('reclaims a crashed paid phase as unknown and ignores the old worker late completion', async () => {
 const f = await workerFixture();
 try {
  const pending = Promise.withResolvers<{prompt: string}>(); f.executor.plan = vi.fn(() => pending.promise);
  const first = f.worker.tick();
  await vi.waitFor(() => expect(f.executor.plan).toHaveBeenCalledTimes(1));
  f.tick(120001); expect(await f.worker.tick()).toBe(true);
  pending.resolve({prompt: 'late answer'}); await first;
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown', prepared: null});
  expect(f.transport).not.toHaveBeenCalled();
  expect(await f.db.experience.findUnique({where: {id: f.opening.id}})).toMatchObject({status: 'unknown', schedulingPaused: true});
 } finally {await f.close();}
});
it('a transient query failure keeps the original task, then resumes reading instead of resubmitting', async () => {
 const f = await workerFixture();
 try {
  await f.worker.tick(); await f.worker.tick(); f.transport.mockRejectedValueOnce(Error('read timeout'));
  await f.worker.tick(); expect(await f.worker.tick()).toBe(false);
  f.tick(10001); await f.worker.tick();
  expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}})).status).toBe('materializing');
  expect(f.transport.mock.calls.filter(x => x[1]?.method === 'POST')).toHaveLength(1);
 } finally {await f.close();}
});

it('blocks mismatched installed execution artifacts before any model operation', async () => {
 const f = await workerFixture();
 try {
  f.executor.assertProfile = () => {throw Error('GENERATION_PROFILE_NOT_INSTALLED');};
  await expect(f.worker.tick()).rejects.toThrow('GENERATION_PROFILE_NOT_INSTALLED');
  expect(f.transport).not.toHaveBeenCalled(); expect(f.executor.plan).not.toHaveBeenCalled();
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'queued'});
 } finally {await f.close();}
});
it('completes two persisted turns: choices only after playback, free response drives a child turn, original survives', async () => {
 const f = await workerFixture();
 try {
  const get = () => f.generation.get({...f.protocol, experienceId: f.opening.id});
  expect((await get()).interaction).toBeNull();
  for (let i = 0; i < 5; i++) await f.worker.tick();
  const ready = await get(); expect(ready.status).toBe('playing'); expect(ready.interaction).toBeNull();
  await expect(f.generation.quote({...f.quoteInput, kind: 'response', commandId: v7(), expectedExperienceRevision: ready.revision, interactionEventId: v7(), text: '我想回屋拿一把伞。'})).rejects.toThrow('GENERATION_NOT_AWAITING');
  const completed = {...f.protocol, commandId: v7(), experienceId: f.opening.id, expectedExperienceRevision: ready.revision, turnId: ready.turn!.id, mediaId: ready.turn!.media!.id};
  const played = await f.generation.completePlayback(completed);
  expect(played.data.status).toBe('awaiting'); expect(played.data.interaction!.choices).toHaveLength(2);
  expect(await f.generation.completePlayback(completed)).toEqual({...played, replayed: true});
  expect(await f.db.interactionEvent.count()).toBe(2);
  const next = await f.generation.quote({...f.protocol, commandId: v7(), experienceId: f.opening.id, expectedExperienceRevision: played.data.revision,
   kind: 'response', interactionEventId: played.data.interaction!.id, text: '我想回屋拿一把伞。'});
  const second = await f.generation.accept({...f.acceptInput(next.data.id), expectedExperienceRevision: played.data.revision});
  expect((await get()).interaction).toBeNull();
  for (let i = 0; i < 5; i++) await f.worker.tick();
  const result = await get(); expect(result.turn!.id).toBe(second.data.id); expect(result.turn!.status).toBe('ready');
  // A delayed acknowledgement replays history; a separate GET keeps the actual current turn.
  expect(await f.generation.completePlayback(completed)).toEqual({...played, replayed: true});
  expect((await get()).turn!.id).toBe(second.data.id);
  expect(await f.db.generationTurn.findUnique({where: {id: second.data.id}})).toMatchObject({parentTurnId: f.turn.id});
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'viewed', parentTurnId: null});
  expect(f.executor.plan).toHaveBeenLastCalledWith(expect.objectContaining({action: '我想回屋拿一把伞。', parentSummary: '两人在天台望向天空。'}));
  expect(await f.db.budgetReservation.count()).toBe(2);
 } finally {await f.close();}
});

it('reads and acknowledges saved playback after reopening SQLite without any provider policy', async () => {
 const f = await workerFixture(); let reopened: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
 try {
  for (let i = 0; i < 5; i++) await f.worker.tick();
  const calls = f.transport.mock.calls.length;
  const files = await f.db.$queryRawUnsafe<Array<{file: string}>>('PRAGMA database_list'); await f.db.$disconnect();
  reopened = await openRuntimeDatabase(files[0]!.file);
  const service = createGenerationPlayback(reopened, f.owner, f.authority, f.services);
  const ready = await service.get({...f.protocol, experienceId: f.opening.id});
  const input = {...f.protocol, commandId: v7(), experienceId: f.opening.id, expectedExperienceRevision: ready.revision, turnId: ready.turn!.id, mediaId: ready.turn!.media!.id};
  const played = await service.completePlayback(input);
  expect(played.data.interaction!.choices).toHaveLength(2);
  expect(await service.completePlayback(input)).toEqual({...played, replayed: true});
  expect(f.transport).toHaveBeenCalledTimes(calls);
 } finally {await reopened?.$disconnect(); await f.close();}
});
it('rolls back playback entirely when stored candidate choices are malformed', async () => {
 const f = await workerFixture();
 try {
  for (let i = 0; i < 5; i++) await f.worker.tick();
  const ready = await f.generation.get({...f.protocol, experienceId: f.opening.id});
  await f.db.generationTurn.update({where: {id: f.turn.id}, data: {result: {summary: '雨停了', choices: []}}});
  const count = await f.db.commandReceipt.count();
  await expect(f.generation.completePlayback({...f.protocol, commandId: v7(), experienceId: f.opening.id,
   expectedExperienceRevision: ready.revision, turnId: f.turn.id, mediaId: ready.turn!.media!.id})).rejects.toThrow('GENERATION_CONTENT_UNCONFIRMED');
  expect(await f.db.commandReceipt.count()).toBe(count);
  expect(await f.db.interactionEvent.count({where: {kind: 'decision'}})).toBe(0);
  expect((await f.generation.get({...f.protocol, experienceId: f.opening.id})).status).toBe('playing');
 } finally {await f.close();}
});

it('keeps the logical current turn and parent across clock rollback through three scenes', async () => {
 const f = await workerFixture();
 try {
  const get = () => f.generation.get({...f.protocol, experienceId: f.opening.id});
  async function finishAndRespond() {
   for (let i = 0; i < 5; i++) await f.worker.tick();
   const ready = await get();
   const played = await f.generation.completePlayback({...f.protocol, commandId: v7(), experienceId: f.opening.id,
    expectedExperienceRevision: ready.revision, turnId: ready.turn!.id, mediaId: ready.turn!.media!.id});
   const quote = await f.generation.quote({...f.protocol, kind: 'response', commandId: v7(), experienceId: f.opening.id,
    expectedExperienceRevision: played.data.revision, interactionEventId: played.data.interaction!.id, text: '一起回屋。'});
   return f.generation.accept({...f.acceptInput(quote.data.id), expectedExperienceRevision: played.data.revision});
  }
  for (let i = 0; i < 5; i++) await f.worker.tick();
  f.tick(-500);
  const second = await finishAndRespond();
  const [firstRow, secondRow] = await Promise.all([f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}}), f.db.generationTurn.findUniqueOrThrow({where: {id: second.data.id}})]);
  expect(secondRow.createdAt.getTime()).toBeLessThan(firstRow.createdAt.getTime());
  expect((await get()).turn?.id).toBe(second.data.id);
  const third = await finishAndRespond();
  expect((await get()).turn?.id).toBe(third.data.id);
  expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: third.data.id}})).parentTurnId).toBe(second.data.id);
 } finally {await f.close();}
});

it('runs another supplier/model/spec through the same durable worker using only the normalized port', async () => {
 const f = await workerFixture(binding => ({...binding, providerId: 'fixture-video', modelId: 'fixture-model', adapterVersion: 'fixture-v1',
  capabilities: {schemaVersion: 1, fixture: true}, parameters: {...binding.parameters, endpointProfileId: 'fixture-endpoint',
   generation: {duration: 8, resolution: '1080p', ratio: '16:9'}}}));
 const submit = vi.fn(), read = vi.fn();
 try {
  // This alternate supplier exists only in tests; no production fallback is registered.
  f.executor.jobs = binding => {
   const {id, createdAt: _, ...spec} = binding, bindingHash = generationBindingHash(spec);
   return {mode: 'job', bindingId: id, bindingHash,
    prepare: plan => ({...plan, duration: 8, resolution: '1080p', ratio: '16:9'}),
    validatePrepared: raw => raw as PreparedVideoInput,
    reference: raw => raw as VideoTaskReference,
    submit: async operationId => {submit(operationId);return {operationId, taskId: 'other-task', providerId: binding.providerId, modelId: binding.modelId,
     bindingId: id, bindingHash, connectionId: binding.parameters.connectionId, accountScopeId: binding.parameters.providerAccountScopeId,
     region: binding.parameters.region, requestHash: 'b'.repeat(64), firstSubmittedAt: f.services.clock.now().toISOString()};},
    read: async raw => {read(raw);return {taskId: 'other-task', status: 'succeeded', video: {url: 'https://media.example/other.mp4', duration: 8, resolution: '1080p', ratio: '16:9'}};},
   };
  };
  f.executor.materialize = vi.fn(async () => ({id: v7(), sha256: 'c'.repeat(64), duration: 8}));
  for (let i = 0; i < 5; i++) expect(await f.worker.tick()).toBe(true);
  expect((await f.generation.get({...f.protocol, experienceId: f.opening.id})).turn).toMatchObject({status: 'ready', media: {duration: 8}});
  expect(submit).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);expect(f.transport).not.toHaveBeenCalled();
  expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}})).providerReference).toMatchObject({providerId: 'fixture-video', modelId: 'fixture-model'});
 } finally {await f.close();}
});
it('rejects a misrouted adapter before planning or submitting', async () => {
 const f = await workerFixture();
 try {
  const original = f.executor.jobs;
  f.executor.jobs = binding => ({...original(binding), bindingId: v7()});
  await f.worker.tick();
  expect(f.executor.plan).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
  expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}})).status).toBe('unknown');
 } finally {await f.close();}
});
it('revalidates persisted preparation before submitting and retains the reservation on corruption', async () => {
 const f = await workerFixture();
 try {
  await f.worker.tick();
  const turn = await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}});
  await f.db.generationTurn.update({where: {id: f.turn.id}, data: {prepared: {...turn.prepared as object, duration: 60}}});
  await f.worker.tick();
  expect(f.transport).not.toHaveBeenCalled();expect(await f.worker.tick()).toBe(false);
  expect((await f.db.budgetReservation.findUniqueOrThrow({where: {id: f.turn.id}})).status).toBe('held');
 } finally {await f.close();}
});
it('does not download a task result belonging to another generation', async () => {
 const f = await workerFixture();
 try {
  await f.worker.tick();await f.worker.tick();
  const original = f.executor.jobs;
  f.executor.jobs = binding => ({...original(binding), read: async () => ({taskId: 'wrong-task', status: 'succeeded', video: {url: 'https://media.example/wrong.mp4', duration: 5, resolution: '768P', ratio: '16:9'}})});
  await f.worker.tick();
  expect(f.executor.materialize).not.toHaveBeenCalled();
  expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}})).status).toBe('unknown');
  expect(await f.worker.tick()).toBe(false);
  expect(f.transport.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
 } finally {await f.close();}
});
it('checks saved delivered specifications again when resuming materialization', async () => {
 const f = await workerFixture();
 try {
  await f.worker.tick();await f.worker.tick();await f.worker.tick();
  const row = await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}});
  const result = row.result as {taskId: string; status: string; video: {url: string; duration: number; ratio: string; resolution: string}};
  await f.db.generationTurn.update({where: {id: row.id}, data: {result: {...result, video: {...result.video, duration: 60}}}});
  await f.worker.tick();expect(f.executor.materialize).not.toHaveBeenCalled();
  expect((await f.db.generationTurn.findUniqueOrThrow({where: {id: row.id}})).status).toBe('unknown');
  expect(await f.worker.tick()).toBe(false);
 } finally {await f.close();}
});
it('quarantines an invalid saved reference without retrying or guessing its supplier', async () => {
 const f = await workerFixture();
 try {
  await f.worker.tick();await f.worker.tick();
  const row = await f.db.generationTurn.findUniqueOrThrow({where: {id: f.turn.id}});
  const {providerId: _, ...invalid} = row.providerReference as unknown as VideoTaskReference;
  await f.db.generationTurn.update({where: {id: row.id}, data: {providerReference: invalid}});
  f.transport.mockClear();
  await f.worker.tick();f.tick(60000);expect(await f.worker.tick()).toBe(false);
  expect(f.transport).not.toHaveBeenCalled();
  expect((await f.db.runtimeOutbox.findUniqueOrThrow({where: {id: row.id}})).status).toBe('blocked');
  expect((await f.db.budgetReservation.findUniqueOrThrow({where: {id: row.id}})).status).toBe('held');
 } finally {await f.close();}
});
