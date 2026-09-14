import {vi} from 'vitest';
import {v7} from 'uuid';
import {fixture} from '../story-aggregate/setup.js';
import {createVideoBindingRegistry} from '../../../src/application/video-binding-registry.js';
import {createExperienceOpeningService} from '../../../src/composition/experience-opening-service.js';
import {createGenerationService, generationBindingHash} from '../../../src/application/generation.js';
import {parseExecutionProfile} from '../../../src/contracts/execution-profile.js';
import type {GenerationPolicy, StagePrice} from '../../../src/ports/generation-policy.js';
export async function setup(budget = '1000000', withImage = false) {
 const f = await fixture();
 const registry = createVideoBindingRegistry({schemaVersion: 1, connections: [{id: 'personal', providerId: 'minimax', region: 'cn', accountScopeId: 'fixture', credentialRef: 'env:TEST_ONLY'}],
  bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'personal', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}]});
 const storyInput = f.create('雨后的天台'), image = withImage ? await f.asset() : null;
 if (image) Object.assign(storyInput.assetSlots, {opening: image.id});
 const story = (await f.service.create(f.owner, storyInput)).data;
 const opening = (await createExperienceOpeningService(f.db, registry).create(f.owner, {...f.protocol, commandId: v7(), storyDraftId: story.id,
  expectedStoryRevision: 1, bindingKey: 'video', expectedBindingVersion: 1, budget: {limitMicros: budget, currency: 'USD'}})).data;
 let now = new Date(Date.now() + 1000);
 const authority = { ...f.owner, storeEpoch: v7(), revalidate: vi.fn(async () => {})};
 const video = registry.resolve(f.owner, {bindingKey: 'video', versionNo: 1});
 const text = (key: string) => ({...video, bindingKey: key, modelId: 'fixture-text', mode: 'text',
  parameters: {...video.parameters, catalogId: 'fixture-text', operationKind: 'structured-generation', protocolVersion: 'text-v1',
   generation: {inputModalities: ['text', 'image'], maxInputTokens: 4096, maxOutputTokens: 1024, temperature: 0.5}}});
 const artifact = {version: 'fixture-only', sha256: 'a'.repeat(64)};
 const profile = parseExecutionProfile({schemaVersion: 1, ownerId: f.owner.ownerId, profileKey: 'test', versionNo: 1, currency: 'USD', graph: artifact,
  planner: {binding: text('planner'), prompt: artifact, outputSchema: artifact, maxCalls: 1, maxCostMicros: '100000'},
  video: {binding: video, maxCalls: 1, maxCostMicros: '100000'},
  validator: {binding: text('validator'), prompt: artifact, outputSchema: artifact, maxCalls: 1, maxCostMicros: '100000'}});
 const price = (binding: unknown): StagePrice => ({version: 'fixture-only', bindingHash: generationBindingHash(binding), validUntil: new Date(now.getTime() + 3600000).toISOString(), currency: 'USD',
  inputTokenMicros: '1', outputTokenMicros: '1', perTokens: '1', outputSecondMicros: '100', inputImageMicros: '5', complete: true, adapterReady: true});
 const evidence: ReturnType<GenerationPolicy['resolve']> = {profile, prices: {planner: price(profile.planner.binding), video: price(video), validator: price(profile.validator.binding)}, audio: 'native', artifactsReady: true, validatorImageLimit: 3};
 const policy = {resolve: vi.fn(() => evidence)}, services = {ids: {next: () => v7()}, clock: {now: () => now}};
 const generation = createGenerationService(f.db, f.owner, authority, policy, services);
 const quoteInput = {...f.protocol, commandId: v7(), experienceId: opening.id, expectedExperienceRevision: 1, kind: 'opening' as const};
 const acceptInput = (quoteId: string) => ({...f.protocol, commandId: v7(), experienceId: opening.id, expectedExperienceRevision: 1, quoteId, consent: true as const});
 return {...f, image, opening, authority, policy, services, evidence, generation, quoteInput, acceptInput, tick: (ms: number) => {now = new Date(now.getTime() + ms);}};
}
