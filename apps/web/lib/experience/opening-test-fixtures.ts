import {vi} from 'vitest';
import {v7} from 'uuid';
import type {CreateExperience, ExperienceOpeningDTO} from 'runtime/contracts/experience-opening';
import type {BindingDirectory, VideoBindingChoice} from 'runtime/contracts/video-binding-registry';
import type {DraftDTO} from 'runtime/contracts/story-draft';
import type {OpeningClient} from './opening-ports';
export const datasetId = v7();
export const protocol = {protocolVersion: 1 as const, datasetId};
export const source: DraftDTO = {...protocol, id: v7(), title: '用户的世界', settings: {world: '海岛', opening: '窗外的雨停了', genre: '', playerRole: '', worldRules: [], tone: ''}, mainCharacter: null,
  assetSlots: {cover: null, opening: null, character: null}, assets: [], schemaVersion: 1, revision: 3,
  createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z', deletedAt: null, archivedAt: null};
export const choice: VideoBindingChoice = {bindingKey: 'video', versionNo: 1, providerId: 'minimax', modelId: 'MiniMax-H3-Max', catalogId: 'minimax-h3-max', connectionId: 'personal', region: 'cn', mode: 'job', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}, canPrepare: true, canDispatch: false, accountVerification: 'unknown'};
export const directory: BindingDirectory = {...protocol, status: 'ready', items: [choice]};
export const command: CreateExperience = {...protocol, commandId: v7(), storyDraftId: source.id, expectedStoryRevision: source.revision, bindingKey: choice.bindingKey, expectedBindingVersion: choice.versionNo, budget: {limitMicros: '0', currency: 'CNY'}};
export function opening(input: CreateExperience = command): ExperienceOpeningDTO {
  const id = v7(), setupId = v7(), time = '2026-09-13T00:00:00.000Z';
  return {protocolVersion: 1, datasetId: input.datasetId, id, revision: 1, status: 'preparing', schedulingPaused: true, createdAt: time,
    story: {protocolVersion: 1, datasetId: input.datasetId, id: v7(), storyDraftId: input.storyDraftId, sourceRevision: input.expectedStoryRevision, versionNo: 1, title: source.title,
      settings: structuredClone(source.settings), mainCharacter: null, assetSlots: structuredClone(source.assetSlots), schemaVersion: 1, createdAt: time, sealedAt: time, contentHash: 'a'.repeat(64)},
    binding: {id: v7(), bindingKey: input.bindingKey, versionNo: input.expectedBindingVersion, providerId: choice.providerId, modelId: choice.modelId, mode: 'job', connectionId: choice.connectionId, region: choice.region, adapterVersion: 'v1', capabilityVersion: 'v1', snapshotHash: 'b'.repeat(64)},
    budget: {...input.budget}, setup: {id: setupId, kind: 'setup', experienceId: id, experienceRevision: 1, options: []}, responseDraft: {id: v7(), experienceId: id, interactionEventId: setupId, text: '', revision: 1}, media: null, canRespond: false, canDispatch: false};
}
export function clientFixture() {return {list: vi.fn<OpeningClient['list']>(async () => ({...protocol, items: [], nextCursor: null})), bindings: vi.fn(async () => structuredClone(directory)), create: vi.fn(async (q: CreateExperience) => ({data: opening(q), replayed: false})), getPreparing: vi.fn(async () => opening())};}
export function deferred<T>() {let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
