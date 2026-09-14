import {beforeAll, afterAll, afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {sceneArtifacts} from '../src/application/scene-artifacts.js';
import {createSceneDirector} from '../src/application/scene-director.js';
import {createGenerationExecutor} from '../src/composition/generation-executor.js';
import {createGenerationWorker} from '../src/application/generation-worker.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
import {generationBindingHash} from '../src/application/generation.js';
import type {GenerationContext} from '../src/application/generation-worker.js';
import type {StructuredTextInput, TextObservation} from '../src/ports/structured-text.js';
import {readExecutionProfile} from '../src/application/execution-profiles.js';
import {createExecutionProfileReadScope} from '../src/infrastructure/db/prisma-execution-profile-store.js';
beforeAll(prepare);afterAll(dispose);afterEach(() => {vi.unstubAllEnvs();vi.restoreAllMocks();});
const confirmed = () => ({verdict: 'confirmed', summary: '角色站在窗边。', choices: [
  {id: 'ask', title: '轻声询问', text: '你在看什么？'}, {id: 'watch', title: '走到窗边', text: '我走到窗边，看看外面的景色。'}], evidenceFrameIndices: [0]});
async function fixture() {
  const f = await setup(), artifacts = sceneArtifacts();
  Object.assign(f.evidence.profile, {graph: artifacts.graph});
  Object.assign(f.evidence.profile.planner, artifacts.planner);Object.assign(f.evidence.profile.validator, artifacts.validator);
  const quote = (await f.generation.quote(f.quoteInput)).data, turn = (await f.generation.accept(f.acceptInput(quote.id))).data;
  const profile = await readExecutionProfile(createExecutionProfileReadScope(f.db, f.owner.ownerId), f.owner, quote.profileId);
  const context: GenerationContext = {turnId: turn.id, story: f.opening.story, profile, quote, action: '', parentSummary: '', validatorImageLimit: 3};
  const inputs: {stage: string; input: StructuredTextInput}[] = [], observed: {stage: string; observation: TextObservation}[] = [];
  const reply = vi.fn(async (stage: string) => stage === 'planner' ? {prompt: '角色走到窗边，望向雨后的城市。'} : confirmed());
  const dependencies = {text: (binding: typeof profile.snapshot.planner.binding) => ({bindingHash: generationBindingHash(binding), invoke: async (input: StructuredTextInput) => {
    inputs.push({stage: binding.bindingKey, input});return {value: await reply(binding.bindingKey), observation: {providerId: binding.providerId, modelId: binding.modelId,
      bindingHash: generationBindingHash(binding), responseId: 'fixture-response', usage: {inputTokens: 20, outputTokens: 10}}};
  }}), observe: vi.fn(async (_context: GenerationContext, stage: 'planner' | 'validator', observation: TextObservation) => {observed.push({stage, observation});})};
  const director = createSceneDirector(dependencies), media = {id: v7(), sha256: 'b'.repeat(64), duration: 5};
  const evidence = {mediaId: media.id, mediaSha256: media.sha256, frames: [{atMs: 0, jpeg: Uint8Array.from([255, 216, 255, 217])}]};
  return {...f, context, director, dependencies, inputs, observed, reply, media, evidence, turn};
}
it('uses sealed story and user intent for one plan, then actual media evidence for one visual validation', async () => {
  const f = await fixture();
  try {
    f.context.action = '我询问窗外是什么';f.context.parentSummary = '两人走到窗边。';
    expect(await f.director.plan(f.context)).toEqual({prompt: '角色走到窗边，望向雨后的城市。'});
    expect(JSON.parse(f.inputs[0]!.input.text)).toMatchObject({userAction: f.context.action, confirmedPast: f.context.parentSummary, story: {title: f.context.story.title}, output: {duration: 5}});
    expect(f.inputs[0]!.input.text).not.toContain('credentialRef');expect(f.inputs[0]!.input.images).toEqual([]);
    expect(await f.director.validate(f.context, f.media, f.evidence)).toMatchObject({summary: '角色站在窗边。', choices: confirmed().choices});
    expect(f.inputs[1]!.input.images[0]!.bytes).toEqual(f.evidence.frames[0]!.jpeg);
    expect(f.observed.map(x => x.stage)).toEqual(['planner', 'validator']);expect(f.reply).toHaveBeenCalledTimes(2);
  } finally {await f.close();}
});
it.each(['prompt', 'graph', 'calls'])('rejects mismatched installed %s artifact before a model call', async kind => {
  const f = await fixture();
  try {
    if (kind === 'prompt') f.context.profile.snapshot.planner.prompt.sha256 = 'c'.repeat(64);
    if (kind === 'graph') f.context.profile.snapshot.graph.version = 'not-installed';
    if (kind === 'calls') f.context.profile.snapshot.planner.maxCalls = 2;
    await expect(f.director.plan(f.context)).rejects.toThrow('GENERATION_ARTIFACT_UNAVAILABLE');expect(f.reply).not.toHaveBeenCalled();
  } finally {await f.close();}
});
it('never retries invalid plans, uncertain evidence or an observation persistence failure', async () => {
  const f = await fixture();
  try {
    f.reply.mockResolvedValueOnce({prompt: 'valid text', extra: 'not allowed'} as never);
    await expect(f.director.plan(f.context)).rejects.toThrow('GENERATION_PLAN_INVALID');expect(f.reply).toHaveBeenCalledOnce();expect(f.observed).toHaveLength(1);
    f.reply.mockResolvedValueOnce({...confirmed(), verdict: 'uncertain'} as never);
    await expect(f.director.validate(f.context, f.media, f.evidence)).rejects.toThrow('GENERATION_CONTENT_UNCONFIRMED');expect(f.reply).toHaveBeenCalledTimes(2);
    f.dependencies.observe.mockRejectedValueOnce(Error('OBSERVATION_WRITE_FAILED'));
    await expect(f.director.plan(f.context)).rejects.toThrow('OBSERVATION_WRITE_FAILED');expect(f.reply).toHaveBeenCalledTimes(3);
  } finally {await f.close();}
});
it.each(['media', 'hash', 'timestamp', 'count', 'jpeg'])('rejects wrong %s frame evidence before the validator call', async kind => {
  const f = await fixture();
  try {
    if (kind === 'media') f.evidence.mediaId = v7();if (kind === 'hash') f.evidence.mediaSha256 = 'c'.repeat(64);
    if (kind === 'timestamp') f.evidence.frames[0]!.atMs = 5000;
    if (kind === 'count') f.evidence.frames = [];
    if (kind === 'jpeg') f.evidence.frames[0]!.jpeg = new Uint8Array(4);
    await expect(f.director.validate(f.context, f.media, f.evidence)).rejects.toThrow('GENERATION_FRAME_EVIDENCE_INVALID');expect(f.reply).not.toHaveBeenCalled();
  } finally {await f.close();}
});
it('blocks references to absent sample frames and duplicate/non-content choices without another call', async () => {
  const f = await fixture();
  try {
    f.reply.mockResolvedValueOnce({...confirmed(), evidenceFrameIndices: [3]} as never);
    await expect(f.director.validate(f.context, f.media, f.evidence)).rejects.toThrow('GENERATION_CONTENT_UNCONFIRMED');
    f.reply.mockResolvedValueOnce({...confirmed(), choices: [confirmed().choices[0], confirmed().choices[0]]} as never);
    await expect(f.director.validate(f.context, f.media, f.evidence)).rejects.toThrow('GENERATION_CONTENT_UNCONFIRMED');expect(f.reply).toHaveBeenCalledTimes(2);
  } finally {await f.close();}
});
it.each(['LANGSMITH_TRACING', 'LANGSMITH_TRACING_V2', 'LANGCHAIN_TRACING_V2', 'LANGCHAIN_TRACING', 'LANGCHAIN_VERBOSE'])('does not start a runnable under unconfigured ambient %s', async flag => {
  const f = await fixture();
  try {vi.stubEnv(flag, 'true');await expect(f.director.plan(f.context)).rejects.toThrow('GENERATION_TRACING_NOT_CONFIGURED');expect(f.reply).not.toHaveBeenCalled();}
  finally {await f.close();}
});
it('composes LangChain stages with the durable SQLite Worker, preserving the playback decision boundary', async () => {
  const f = await fixture();
  try {
    const transport = vi.fn<typeof fetch>(async (_url, init) => Response.json(init?.method === 'POST' ? {task_id: 'fixture-task'} : {
      task: {id: 'fixture-task', model: 'MiniMax-H3-Max', status: 'succeeded', task_type: 'generation', modality: 'video', ratio: '16:9',
        resolution: '768P', duration: 5, content: {url: 'https://fixture.example/video'}}}));
    const sample = vi.fn(async () => f.evidence), executor = createGenerationExecutor({...f.dependencies, assertVideoProfile() {},
      jobs: binding => createMiniMaxVideoJobs(binding, {apiKey: 'TEST_ONLY', fetchImpl: transport}), materialize: async () => f.media, sample});
    const worker = createGenerationWorker(f.db, f.owner, f.authority, executor, f.services);
    for (let i = 0; i < 5; i++) expect(await worker.tick()).toBe(true);
    expect(await worker.tick()).toBe(false);expect(f.reply).toHaveBeenCalledTimes(2);expect(sample).toHaveBeenCalledOnce();
    expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'ready', media: f.media, result: {summary: confirmed().summary}});
    expect(await f.db.interactionEvent.count({where: {kind: 'decision'}})).toBe(0);
    expect(transport.mock.calls.filter(x => x[1]?.method === 'POST')).toHaveLength(1);
  } finally {await f.close();}
});
it.each(['model', 'observation'])('bounds sampling plus %s work within one Worker deadline and rejects late success', async stalled => {
  const f = await fixture();
  let releaseSample!: () => void, sampled!: () => void, releaseLast!: () => void, reachedLast!: () => void;
  const sampleGate = new Promise<void>(resolve => {releaseSample = resolve;}), sampleStarted = new Promise<void>(resolve => {sampled = resolve;});
  const lastGate = new Promise<void>(resolve => {releaseLast = resolve;}), lastStarted = new Promise<void>(resolve => {reachedLast = resolve;});
  const abort = new AbortController();let observedSignal: AbortSignal | undefined;
  try {
    const transport = vi.fn<typeof fetch>(async (_url, init) => Response.json(init?.method === 'POST' ? {task_id: 'fixture-task'} : {
      task: {id: 'fixture-task', model: 'MiniMax-H3-Max', status: 'succeeded', task_type: 'generation', modality: 'video', ratio: '16:9',
        resolution: '768P', duration: 5, content: {url: 'https://fixture.example/video'}}}));
    const executor = createGenerationExecutor({...f.dependencies,
      observe: async (context, stage, observation, signal) => {
        if (stage === 'validator' && stalled === 'observation') {observedSignal = signal;reachedLast();await lastGate;}
        await f.dependencies.observe(context, stage, observation);
      }, assertVideoProfile() {}, jobs: binding => createMiniMaxVideoJobs(binding, {apiKey: 'TEST_ONLY', fetchImpl: transport}),
      materialize: async () => f.media,
      sample: async (_context, _media, signal) => {expect(signal).toBe(abort.signal);sampled();await sampleGate;return f.evidence;},
    });
    const worker = createGenerationWorker(f.db, f.owner, f.authority, executor, f.services);
    for (let i = 0; i < 4; i++) await worker.tick();
    if (stalled === 'model') f.reply.mockImplementationOnce(async () => {reachedLast();await lastGate;return confirmed();});
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    const pending = worker.tick();await sampleStarted;
    expect(timeout).toHaveBeenCalledWith(100000);
    f.tick(70000);releaseSample();await lastStarted;
    if (stalled === 'observation') expect(observedSignal).toBe(abort.signal);
    f.tick(30000);abort.abort();expect(await pending).toBe(true);
    expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown'});
    expect(await f.db.runtimeOutbox.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'blocked'});
    expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held'});
    releaseLast();await new Promise(resolve => setImmediate(resolve));
    f.tick(25000);expect(await worker.tick()).toBe(false);
    expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown'});
    expect(f.reply).toHaveBeenCalledTimes(2);
  } finally {releaseSample();releaseLast();vi.restoreAllMocks();await f.close();}
});
it.each(['authority', 'transaction'])('rolls back success when the deadline expires during the %s commit window', async window => {
  const f = await fixture(), abort = new AbortController();
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), waiting = new Promise<void>(resolve => {reached = resolve;});
  try {
    const transport = vi.fn<typeof fetch>(async (_url, init) => Response.json(init?.method === 'POST' ? {task_id: 'fixture-task'} : {
      task: {id: 'fixture-task', model: 'MiniMax-H3-Max', status: 'succeeded', task_type: 'generation', modality: 'video', ratio: '16:9',
        resolution: '768P', duration: 5, content: {url: 'https://fixture.example/video'}}}));
    const executor = createGenerationExecutor({...f.dependencies, assertVideoProfile() {},
      jobs: binding => createMiniMaxVideoJobs(binding, {apiKey: 'TEST_ONLY', fetchImpl: transport}),
      materialize: async () => f.media, sample: async () => f.evidence});
    const extended = f.db.$extends({query: {experience: {async update({args, query}) {
      const result = await query(args);
      if (window === 'transaction' && args.data.status === 'playing') {reached();await gate;}
      return result;
    }}}});
    const worker = createGenerationWorker(extended as unknown as typeof f.db, f.owner, f.authority, executor, f.services);
    for (let i = 0; i < 4; i++) await worker.tick();
    if (window === 'authority') f.authority.revalidate.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {reached();await gate;});
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    const pending = worker.tick();await waiting;
    f.tick(100000);abort.abort();release();expect(await pending).toBe(true);
    expect(await f.db.generationTurn.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'unknown'});
    expect(await f.db.runtimeOutbox.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'blocked'});
    expect(await f.db.experience.findUnique({where: {id: f.opening.id}})).toMatchObject({status: 'unknown', schedulingPaused: true});
    expect(await f.db.budgetReservation.findUnique({where: {id: f.turn.id}})).toMatchObject({status: 'held'});
    f.tick(25000);expect(await worker.tick()).toBe(false);expect(f.reply).toHaveBeenCalledTimes(2);
  } finally {release();vi.restoreAllMocks();await f.close();}
});
