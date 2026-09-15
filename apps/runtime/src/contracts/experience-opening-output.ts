import {fields, parseId, parseProtocol, parseRevision} from './story-draft-validation.js';
import {bindingLabel, modelIdentifier} from './provider-binding-validation.js';
import {parseStoryVersionDTO} from './story-version-validation.js';
import {parseBudget} from './experience-opening-validation.js';
import {isTimestamp} from './primitives.js';
import type {PublicBinding} from './provider-binding.js';
import type {ExperienceOpeningDTO, ExperienceOpeningResult} from './experience-opening.js';
import type {BindingDirectory, VideoBindingChoice} from './video-binding-registry.js';
import {getDeployment} from './video-deployments.js';
import {miniMaxRegion, validateMiniMaxGeneration} from '../providers/minimax-constraints.js';
import {polloRegion, validatePolloGeneration} from '../providers/pollo-constraints.js';

const invalid = () => Error('INVALID_EXPERIENCE_DTO');
function publicBinding(v: unknown): PublicBinding {
  fields(v, ['id', 'bindingKey', 'versionNo', 'providerId', 'modelId', 'mode', 'connectionId', 'region', 'adapterVersion', 'capabilityVersion', 'snapshotHash']);
  if (!['job', 'realtime'].includes(v.mode as string) || typeof v.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.snapshotHash)) throw invalid();
  return {id: parseId(v.id), bindingKey: bindingLabel(v.bindingKey), versionNo: parseRevision(v.versionNo),
    providerId: bindingLabel(v.providerId), modelId: modelIdentifier(v.modelId), mode: v.mode as PublicBinding['mode'],
    connectionId: bindingLabel(v.connectionId), region: bindingLabel(v.region), adapterVersion: bindingLabel(v.adapterVersion),
    capabilityVersion: bindingLabel(v.capabilityVersion), snapshotHash: v.snapshotHash};
}
export function parseExperienceOpeningDTO(v: unknown): ExperienceOpeningDTO {
  try {
    fields(v, ['protocolVersion', 'datasetId', 'id', 'revision', 'status', 'schedulingPaused', 'createdAt', 'story', 'binding', 'budget', 'setup', 'responseDraft', 'media', 'canRespond', 'canDispatch']);
    const protocol = parseProtocol(v), id = parseId(v.id), story = parseStoryVersionDTO(v.story), binding = publicBinding(v.binding), budget = parseBudget(v.budget);
    if (v.revision !== 1 || v.status !== 'preparing' || v.schedulingPaused !== true || v.media !== null ||
      v.canRespond !== false || v.canDispatch !== false || !isTimestamp(v.createdAt) ||
      Date.parse(v.createdAt) < Date.parse(story.sealedAt) || story.datasetId !== protocol.datasetId) throw invalid();
    const s = v.setup, d = v.responseDraft;
    fields(s, ['id', 'kind', 'experienceId', 'experienceRevision', 'options']);
    fields(d, ['id', 'experienceId', 'interactionEventId', 'text', 'revision']);
    if (s.kind !== 'setup' || s.experienceId !== id || s.experienceRevision !== 1 || !Array.isArray(s.options) || s.options.length !== 0 ||
      d.experienceId !== id || d.interactionEventId !== s.id || d.text !== '' || d.revision !== 1) throw invalid();
    return {...protocol, id, revision: 1, status: 'preparing', schedulingPaused: true, createdAt: v.createdAt,
      story, binding, budget, setup: {id: parseId(s.id), kind: 'setup', experienceId: id, experienceRevision: 1, options: []},
      responseDraft: {id: parseId(d.id), experienceId: id, interactionEventId: parseId(s.id), text: '', revision: 1},
      media: null, canRespond: false, canDispatch: false};
  } catch { throw invalid(); }
}
export function parseExperienceOpeningResult(v: unknown): ExperienceOpeningResult {
  try {
    fields(v, ['data', 'replayed']);
    if (typeof v.replayed !== 'boolean') throw invalid();
    return {data: parseExperienceOpeningDTO(v.data), replayed: v.replayed};
  } catch { throw invalid(); }
}
function choice(v: unknown): VideoBindingChoice {
  fields(v, ['bindingKey', 'versionNo', 'providerId', 'modelId', 'catalogId', 'connectionId', 'region', 'mode', 'operationKind', 'generation', 'canPrepare', 'canDispatch', 'accountVerification']);
  if (v.canPrepare !== true || v.canDispatch !== false || v.accountVerification !== 'unknown' || v.mode !== 'job' ||
    !['text-to-video', 'image-to-video'].includes(v.operationKind as string)) throw invalid();
  const providerId = bindingLabel(v.providerId), catalogId = bindingLabel(v.catalogId), modelId = modelIdentifier(v.modelId);
  const deployment = getDeployment(providerId, catalogId);
  if (deployment.mode !== 'job' || deployment.endpoint !== modelId) throw invalid();
  const generation = providerId === 'pollo' ? validatePolloGeneration(modelId, v.operationKind as string, v.generation) : validateMiniMaxGeneration(modelId, v.operationKind as string, v.generation);
  const region = providerId === 'pollo' ? polloRegion(v.region) : miniMaxRegion(v.region);
  return {bindingKey: bindingLabel(v.bindingKey), versionNo: parseRevision(v.versionNo), providerId, modelId, catalogId,
    connectionId: bindingLabel(v.connectionId), region, mode: 'job',
    operationKind: v.operationKind as VideoBindingChoice['operationKind'],
    generation,
    canPrepare: true, canDispatch: false, accountVerification: 'unknown'};
}
export function parseBindingDirectory(v: unknown): BindingDirectory {
  try {
    fields(v, ['protocolVersion', 'datasetId', 'status', 'items']);
    const protocol = parseProtocol(v);
    if (!['ready', 'empty', 'unavailable', 'not_initialized'].includes(v.status as string) || !Array.isArray(v.items) ||
      v.items.length > 128 || (v.status === 'ready' ? v.items.length === 0 : v.items.length !== 0)) throw invalid();
    const items = v.items.map(choice), keys = new Set(items.map(i => `${i.bindingKey}/${i.versionNo}`));
    if (keys.size !== items.length) throw invalid();
    return {...protocol, status: v.status as BindingDirectory['status'], items};
  } catch { throw invalid(); }
}
