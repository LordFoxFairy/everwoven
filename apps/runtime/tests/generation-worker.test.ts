import {beforeAll, afterAll, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {createGenerationWorker, type GenerationExecutor} from '../src/application/generation-worker.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
beforeAll(prepare); afterAll(dispose);
async function workerFixture() {
 const f = await setup(), quote = await f.generation.quote(f.quoteInput), accepted = await f.generation.accept(f.acceptInput(quote.data.id));
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
  expect(await f.db.generationTurn.findUnique({where: {id: second.data.id}})).toMatchObject({parentTurnId: f.turn.id});
  expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'viewed', parentTurnId: null});
  expect(f.executor.plan).toHaveBeenLastCalledWith(expect.objectContaining({action: '我想回屋拿一把伞。', parentSummary: '两人在天台望向天空。'}));
  expect(await f.db.budgetReservation.count()).toBe(2);
 } finally {await f.close();}
});
