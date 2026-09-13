import type {BindingSpec, TextBindingSpec} from './provider-binding.js';
import {bindingLabel, canonicalBindingJson, parseExecutionBinding} from './provider-binding-validation.js';
import {fields, parseId, parseRevision} from './story-draft-validation.js';

export type VersionedArtifact = {version: string; sha256: string};
export type TextStage = {binding: TextBindingSpec; prompt: VersionedArtifact; outputSchema: VersionedArtifact; maxCalls: number; maxCostMicros: string};
export type ExecutionProfileSpec = {
  schemaVersion: 1; ownerId: string; profileKey: string; versionNo: number; currency: 'CNY' | 'USD'; graph: VersionedArtifact;
  planner: TextStage; video: {binding: BindingSpec; maxCalls: 1; maxCostMicros: string}; validator: TextStage;
};
const code = 'INVALID_EXECUTION_PROFILE';
const maxMoney = 9223372036854775807n;
function cost(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > maxMoney) throw Error(code);
  return value;
}
function artifact(value: unknown): VersionedArtifact {
  fields(value, ['version', 'sha256']);
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw Error(code);
  return {version: bindingLabel(value.version), sha256: value.sha256};
}
function textStage(value: unknown, images: boolean): TextStage {
  fields(value, ['binding', 'prompt', 'outputSchema', 'maxCalls', 'maxCostMicros']);
  const binding = parseExecutionBinding(value.binding);
  if (binding.mode !== 'text' || (images && binding.parameters.generation.inputModalities.length !== 2) ||
    !Number.isSafeInteger(value.maxCalls) || (value.maxCalls as number) < 1 || (value.maxCalls as number) > 3) throw Error(code);
  return {binding, prompt: artifact(value.prompt), outputSchema: artifact(value.outputSchema),
    maxCalls: value.maxCalls as number, maxCostMicros: cost(value.maxCostMicros)};
}
/** Configuration integrity only. Capability/price evidence is checked by Quote, not inferred here. */
export function parseExecutionProfile(input: unknown): ExecutionProfileSpec {
  try {
    input = canonicalBindingJson(input);
    fields(input, ['schemaVersion', 'ownerId', 'profileKey', 'versionNo', 'currency', 'graph', 'planner', 'video', 'validator']);
    if (input.schemaVersion !== 1 || !['CNY', 'USD'].includes(input.currency as string)) throw Error(code);
    const ownerId = parseId(input.ownerId), planner = textStage(input.planner, false), validator = textStage(input.validator, true);
    fields(input.video, ['binding', 'maxCalls', 'maxCostMicros']);
    const videoBinding = parseExecutionBinding(input.video.binding);
    if (videoBinding.mode !== 'job' || !['text-to-video', 'image-to-video'].includes(videoBinding.parameters.operationKind) || input.video.maxCalls !== 1) throw Error(code);
    if ([planner.binding, videoBinding, validator.binding].some(b => b.ownerId !== ownerId)) throw Error(code);
    const video = {binding: videoBinding, maxCalls: 1 as const, maxCostMicros: cost(input.video.maxCostMicros)};
    if ([planner, video, validator].reduce((sum, stage) => sum + BigInt(stage.maxCostMicros), 0n) > maxMoney) throw Error(code);
    return {schemaVersion: 1, ownerId, profileKey: bindingLabel(input.profileKey), versionNo: parseRevision(input.versionNo),
      currency: input.currency as ExecutionProfileSpec['currency'], graph: artifact(input.graph), planner, video, validator};
  } catch {throw Error(code);}
}
