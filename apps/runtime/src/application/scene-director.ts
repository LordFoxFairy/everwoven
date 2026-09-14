import {buildSceneInput} from './scene-input.js';
import {RunnableLambda} from '@langchain/core/runnables';
import {isDeepStrictEqual} from 'node:util';
import {generationBindingHash} from './generation.js';
import {parseExecutionProfile} from '../contracts/execution-profile.js';
import {fields, parseId} from '../contracts/story-draft-validation.js';
import {parseSceneResult} from '../contracts/generation-output.js';
import type {GenerationContext, PrivateSceneMedia} from './generation-worker.js';
import type {PinnedProfile} from '../ports/execution-profile-store.js';
import type {StructuredTextResolver, StructuredTextResult, StructuredTextInput, TextObservation} from '../ports/structured-text.js';
import {sceneArtifacts, plannerPrompt, validatorPrompt, plannerSchema, validatorSchema} from './scene-artifacts.js';

export type SceneFrameEvidence = {mediaId: string; mediaSha256: string; frames: {atMs: number; jpeg: Uint8Array}[]};
export type SceneDirectorDependencies = {
  text: StructuredTextResolver;
  /** Must durably record an observation before returning. A write failure does not authorize another model call. */
  observe(context: GenerationContext, stage: 'planner' | 'validator', observation: TextObservation, signal?: AbortSignal): Promise<void>;
};
/** LangChain executes one bounded stage at a time. SQLite Worker owns scheduling, leases and paid recovery. */
export function createSceneDirector(dependencies: SceneDirectorDependencies) {
  function assertProfile(profile: PinnedProfile) {
    const spec = parseExecutionProfile(profile.snapshot), artifacts = sceneArtifacts();
    if (!isDeepStrictEqual(spec.graph, artifacts.graph) || ['planner', 'validator'].some(stage => {
      const key = stage as 'planner' | 'validator';return !isDeepStrictEqual(spec[key].prompt, artifacts[key].prompt) ||
        !isDeepStrictEqual(spec[key].outputSchema, artifacts[key].outputSchema) || spec[key].maxCalls !== 1;
    })) throw Error('GENERATION_ARTIFACT_UNAVAILABLE');
  }
  function scene(context: GenerationContext) {
    parseId(context.turnId);assertProfile(context.profile);
    if (context.quote.profileId !== context.profile.id || context.quote.datasetId !== context.story.datasetId ||
      typeof context.action !== 'string' || context.action.length > 2000 || typeof context.parentSummary !== 'string' || context.parentSummary.length > 2000)
      throw Error('GENERATION_CONTEXT_INVALID');
    return buildSceneInput(context);
  }
  async function invoke(context: GenerationContext, stage: 'planner' | 'validator', input: StructuredTextInput, signal?: AbortSignal) {
    // Local V1 has no approved remote tracing destination. Do not let ambient tracing/verbose flags export scene data.
    if (['LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGSMITH_TRACING_V2', 'LANGCHAIN_VERBOSE'].some(key =>
      process.env[key] && !['false', '0'].includes(process.env[key]!.toLowerCase()))) throw Error('GENERATION_TRACING_NOT_CONFIGURED');
    signal?.throwIfAborted();
    const binding = context.profile.snapshot[stage].binding, expectedHash = generationBindingHash(binding), model = dependencies.text(structuredClone(binding));
    if (model.bindingHash !== expectedHash) throw Error('GENERATION_TEXT_BINDING_MISMATCH');
    const chain = RunnableLambda.from(async (request: StructuredTextInput): Promise<StructuredTextResult> => model.invoke(request, signal));
    const result = await chain.invoke(input, {callbacks: [], signal, recursionLimit: 1, runName: `scene-${stage}`});
    if (result.observation.bindingHash !== expectedHash || result.observation.providerId !== binding.providerId || result.observation.modelId !== binding.modelId)
      throw Error('GENERATION_TEXT_BINDING_MISMATCH');
    signal?.throwIfAborted();await dependencies.observe(context, stage, result.observation, signal);signal?.throwIfAborted();
    return result.value;
  }
  return {
    assertProfile,
    async plan(context: GenerationContext, signal?: AbortSignal) {
      const input = scene(context), raw = await invoke(context, 'planner', {system: plannerPrompt, text: JSON.stringify(input),
        schemaName: 'scene_plan', schema: structuredClone(plannerSchema), images: []}, signal);
      try {
        fields(raw, ['prompt']);if (typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 7000) throw Error();
        return {prompt: raw.prompt.trim()};
      } catch {throw Error('GENERATION_PLAN_INVALID');}
    },
    async validate(context: GenerationContext, media: PrivateSceneMedia, evidence: SceneFrameEvidence, signal?: AbortSignal) {
      const input = scene(context);parseId(media.id);
      if (evidence.mediaId !== media.id || evidence.mediaSha256 !== media.sha256 || !/^[a-f0-9]{64}$/.test(media.sha256) ||
        media.duration !== context.quote.summary.duration || !Number.isSafeInteger(context.validatorImageLimit) || context.validatorImageLimit < 1 ||
        context.validatorImageLimit > 16 || !Array.isArray(evidence.frames) || !evidence.frames.length || evidence.frames.length > context.validatorImageLimit)
        throw Error('GENERATION_FRAME_EVIDENCE_INVALID');
      let previous = -1;
      for (const frame of evidence.frames) {
        if (!Number.isSafeInteger(frame.atMs) || frame.atMs < 0 || frame.atMs <= previous || frame.atMs >= media.duration * 1000 ||
          !(frame.jpeg instanceof Uint8Array) || frame.jpeg.length < 4 || frame.jpeg.length > 262144 || frame.jpeg[0] !== 255 || frame.jpeg[1] !== 216 ||
          frame.jpeg[frame.jpeg.length - 2] !== 255 || frame.jpeg[frame.jpeg.length - 1] !== 217) throw Error('GENERATION_FRAME_EVIDENCE_INVALID');
        previous = frame.atMs;
      }
      const raw = await invoke(context, 'validator', {system: validatorPrompt,
        text: JSON.stringify({...input, sampledFrameTimesMs: evidence.frames.map(frame => frame.atMs)}),
        schemaName: 'scene_validation', schema: structuredClone(validatorSchema), images: evidence.frames.map(frame => ({mimeType: 'image/jpeg', bytes: frame.jpeg}))}, signal);
      try {
        fields(raw, ['verdict', 'summary', 'choices', 'evidenceFrameIndices']);
        if (raw.verdict !== 'confirmed' || !Array.isArray(raw.evidenceFrameIndices) || !raw.evidenceFrameIndices.length ||
          new Set(raw.evidenceFrameIndices).size !== raw.evidenceFrameIndices.length || raw.evidenceFrameIndices.some(index =>
            !Number.isSafeInteger(index) || index < 0 || index >= evidence.frames.length)) throw Error();
        const scene = parseSceneResult({summary: raw.summary, choices: raw.choices});
        if (new Set(scene.choices.map(choice => choice.text.trim())).size !== scene.choices.length) throw Error();
        return scene;
      } catch {throw Error('GENERATION_CONTENT_UNCONFIRMED');}
    },
  };
}
