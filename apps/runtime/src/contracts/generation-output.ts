import {fields, parseId, parseProtocol, parseRevision} from './story-draft-validation.js';
import type {CompletePlaybackInput, PlayDTO, QuoteDTO, QuoteState, TurnDTO, GenerationQuoteInput, AcceptGenerationInput} from './generation.js';
import {isTimestamp} from './primitives.js';
import {modelIdentifier, bindingLabel} from './provider-binding-validation.js';
import {parseBudget} from './experience-opening-validation.js';

export type SceneResult = {summary: string; choices: Array<{id: string; title: string; text: string}>};
const invalid = () => Error('INVALID_GENERATION_DTO');
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value;
}
export function parseSceneResult(value: unknown): SceneResult {
  try {
    fields(value, ['summary', 'choices']);
    const summary = text(value.summary, 2000);
    if (!Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 4) throw invalid();
    const choices = value.choices.map(choice => {
      fields(choice, ['id', 'title', 'text']);
      if (typeof choice.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(choice.id)) throw invalid();
      return {id: choice.id, title: text(choice.title, 100), text: text(choice.text, 2000)};
    });
    if (new Set(choices.map(choice => choice.id)).size !== choices.length) throw invalid();
    return {summary, choices};
  } catch {throw invalid();}
}

const generating = ['queued', 'planning', 'prepared', 'submitting', 'polling', 'materializing', 'checking', 'validating'];
const errors = ['GENERATION_RESULT_UNKNOWN', 'GENERATION_READ_INTERRUPTED', 'PROVIDER_GENERATION_FAILED'];

/** Only application facts cross the boundary: no provider URLs, paths, credentials or raw errors. */
export function parsePlayDTO(value: unknown): PlayDTO {
  try {
    fields(value, ['protocolVersion', 'datasetId', 'experienceId', 'title', 'revision', 'status', 'turn', 'interaction'],['inherited']);
    const protocol = parseProtocol(value), experienceId = parseId(value.experienceId), revision = parseRevision(value.revision);
    const title = text(value.title, 240);
    if (!['preparing', 'paused', 'generating', 'playing', 'awaiting', 'unknown', 'failed'].includes(value.status as string)) throw invalid();
    let turn: PlayDTO['turn'] = null, interaction: PlayDTO['interaction'] = null;
    if (value.turn !== null) {
      fields(value.turn, ['id', 'status', 'media', 'errorCode']);
      const t = value.turn;
      if (![...generating, 'ready', 'viewed', 'unknown', 'failed'].includes(t.status as string) ||
        (t.errorCode !== null && !errors.includes(t.errorCode as string))) throw invalid();
      let media: NonNullable<PlayDTO['turn']>['media'] = null;
      if (t.media !== null) {
        fields(t.media, ['id', 'duration']);
        if (typeof t.media.duration !== 'number' || !Number.isFinite(t.media.duration) || t.media.duration <= 0) throw invalid();
        media = {id: parseId(t.media.id), duration: t.media.duration};
      }
      if (['ready', 'viewed'].includes(t.status as string) !== Boolean(media)) throw invalid();
      turn = {id: parseId(t.id), status: t.status as string, media, errorCode: t.errorCode as string | null};
    }
    if (value.interaction !== null) {
      fields(value.interaction, ['id', 'summary', 'choices']);
      interaction = {id: parseId(value.interaction.id), ...parseSceneResult({summary: value.interaction.summary, choices: value.interaction.choices})};
    }
    let inherited:PlayDTO['inherited'];
    if(value.inherited!==undefined){fields(value.inherited,['savepointId','turnId','mediaId','duration']);const m=value.inherited;
      if(turn!==null||revision!==1||!['paused','awaiting'].includes(value.status as string)||typeof m.duration!=='number'||m.duration<=0||m.duration>120)throw invalid();
      inherited={savepointId:parseId(m.savepointId),turnId:parseId(m.turnId),mediaId:parseId(m.mediaId),duration:m.duration};}
    if(value.status==='paused'&&!inherited)throw invalid();
    if (value.status === 'preparing' ? turn !== null || Boolean(inherited) : turn === null && !inherited) throw invalid();
    if ((value.status === 'awaiting') !== Boolean(interaction)) throw invalid();
    const expected = {playing: 'ready', awaiting: 'viewed', unknown: 'unknown', failed: 'failed'} as const;
    if (Object.hasOwn(expected, value.status as string) && !(value.status==='awaiting'&&inherited) && turn?.status !== expected[value.status as keyof typeof expected]) throw invalid();
    if (value.status === 'generating' && !generating.includes(turn!.status)) throw invalid();
    if (['playing', 'awaiting'].includes(value.status as string) && turn && turn.errorCode !== null) throw invalid();
    return {...protocol, experienceId, title, revision, status: value.status as string, turn, interaction,...(inherited?{inherited}:{})};
  } catch {throw invalid();}
}

export type PlaybackResult = {data: PlayDTO; replayed: boolean};
export type QuoteResult = {data: QuoteDTO; replayed: boolean};
export type AcceptResult = {data: TurnDTO; replayed: boolean};
export function parseQuoteDTO(value: unknown): QuoteDTO {
 try {
  fields(value, ['protocolVersion', 'datasetId', 'id', 'experienceId', 'experienceRevision', 'profileId', 'maxCostMicros', 'currency', 'expiresAt', 'createdAt', 'summary']);
  const protocol = parseProtocol(value), budget = parseBudget({limitMicros: value.maxCostMicros, currency: value.currency});
  if (budget.limitMicros === '0' || !isTimestamp(value.createdAt) || !isTimestamp(value.expiresAt) || value.expiresAt <= value.createdAt) throw invalid();
  fields(value.summary, ['title', 'prompt', 'modelId', 'region', 'duration', 'resolution', 'ratio', 'audio', 'inputAssetIds']);
  const s = value.summary;
  if (typeof s.prompt !== 'string' || s.prompt.length > 16000 || typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration <= 0 || s.duration > 120 ||
   !['native', 'silent'].includes(s.audio as string) || !Array.isArray(s.inputAssetIds) || s.inputAssetIds.length > 16 || new Set(s.inputAssetIds).size !== s.inputAssetIds.length) throw invalid();
  return {...protocol, id: parseId(value.id), experienceId: parseId(value.experienceId), experienceRevision: parseRevision(value.experienceRevision), profileId: parseId(value.profileId),
   maxCostMicros: budget.limitMicros, currency: budget.currency, createdAt: value.createdAt, expiresAt: value.expiresAt,
   summary: {title: text(s.title, 240), prompt: s.prompt, modelId: modelIdentifier(s.modelId), region: bindingLabel(s.region), duration: s.duration,
    resolution: bindingLabel(s.resolution), ratio: bindingLabel(s.ratio), audio: s.audio as 'native' | 'silent', inputAssetIds: s.inputAssetIds.map(parseId)}};
 } catch {throw invalid();}
}
export function parseQuoteResult(value: unknown, input?: GenerationQuoteInput): QuoteResult {
 try {
  fields(value, ['data', 'replayed']);if (typeof value.replayed !== 'boolean') throw invalid();
  const data = parseQuoteDTO(value.data);
  if (input && (data.datasetId !== input.datasetId || data.experienceId !== input.experienceId || data.experienceRevision !== input.expectedExperienceRevision ||
    (input.kind === 'response' && data.summary.prompt !== input.text.trim()))) throw invalid();
  return {data, replayed: value.replayed};
 } catch {throw invalid();}
}
export function parseQuoteState(value: unknown): QuoteState {
 try {fields(value, ['quote', 'acceptedTurnId']);return {quote: parseQuoteDTO(value.quote), acceptedTurnId: value.acceptedTurnId === null ? null : parseId(value.acceptedTurnId)};}
 catch {throw invalid();}
}
export function parseAcceptResult(value: unknown, input?: AcceptGenerationInput): AcceptResult {
 try {
  fields(value, ['data', 'replayed']);fields(value.data, ['protocolVersion', 'datasetId', 'id', 'experienceId', 'quoteId', 'status', 'createdAt']);
  const v = value.data, protocol = parseProtocol(v);
  if (typeof value.replayed !== 'boolean' || v.status !== 'queued' || !isTimestamp(v.createdAt)) throw invalid();
  const data: TurnDTO = {...protocol, id: parseId(v.id), experienceId: parseId(v.experienceId), quoteId: parseId(v.quoteId), status: 'queued', createdAt: v.createdAt};
  if (input && (data.datasetId !== input.datasetId || data.experienceId !== input.experienceId || data.quoteId !== input.quoteId)) throw invalid();
  return {data, replayed: value.replayed};
 } catch {throw invalid();}
}
export function parsePlaybackResult(value: unknown, input?: CompletePlaybackInput): PlaybackResult {
  try {
    fields(value, ['data', 'replayed']);
    if (typeof value.replayed !== 'boolean') throw invalid();
    const data = parsePlayDTO(value.data);
    if (data.status !== 'awaiting' || data.turn?.status !== 'viewed') throw invalid();
    if (input && (data.protocolVersion !== input.protocolVersion || data.datasetId !== input.datasetId ||
      data.experienceId !== input.experienceId || data.revision !== input.expectedExperienceRevision + 1 ||
      data.turn.id !== input.turnId || data.turn.media?.id !== input.mediaId)) throw invalid();
    return {data, replayed: value.replayed};
  } catch {throw invalid();}
}
