import {fields,parseId,parseProtocol,parseRevision} from './story-draft-validation.js';
import type {StoryProtocol} from './story-draft.js';
export type OpeningQuoteInput=StoryProtocol&{commandId:string;experienceId:string;expectedExperienceRevision:number;kind:'opening'};
export type AcceptGenerationInput=StoryProtocol&{commandId:string;experienceId:string;expectedExperienceRevision:number;quoteId:string;consent:true};
export type QuoteDTO=StoryProtocol&{id:string;experienceId:string;experienceRevision:number;profileId:string;maxCostMicros:string;currency:'CNY'|'USD';expiresAt:string;createdAt:string;
 summary:{title:string;prompt:string;modelId:string;region:string;duration:number;resolution:string;ratio:string;audio:'native'|'silent';inputAssetIds:string[]}};
export type TurnDTO=StoryProtocol&{id:string;experienceId:string;quoteId:string;status:string;createdAt:string};
export function parseOpeningQuote(value:unknown):OpeningQuoteInput{
 const protocol=generationProtocol(value);try{fields(value,['protocolVersion','datasetId','commandId','experienceId','expectedExperienceRevision','kind']);if(value.kind!=='opening')throw Error();
 return {...protocol,kind:'opening',commandId:parseId(value.commandId),experienceId:parseId(value.experienceId),expectedExperienceRevision:parseRevision(value.expectedExperienceRevision)};}catch{throw Error('INVALID_GENERATION_COMMAND');}
}
export function parseAcceptGeneration(value:unknown):AcceptGenerationInput{
 const protocol=generationProtocol(value);try{fields(value,['protocolVersion','datasetId','commandId','experienceId','expectedExperienceRevision','quoteId','consent']);if(value.consent!==true)throw Error();
 return {...protocol,consent:true,commandId:parseId(value.commandId),experienceId:parseId(value.experienceId),quoteId:parseId(value.quoteId),expectedExperienceRevision:parseRevision(value.expectedExperienceRevision)};}catch{throw Error('INVALID_GENERATION_COMMAND');}
}
export type ResponseQuoteInput = StoryProtocol & {commandId: string; experienceId: string; expectedExperienceRevision: number; kind: 'response'; interactionEventId: string; text: string};
export type GenerationQuoteInput = OpeningQuoteInput | ResponseQuoteInput;
export type GetPlayInput = StoryProtocol & {experienceId: string};
export type GetQuoteInput = GetPlayInput & {quoteId: string};
export type QuoteState = {quote: QuoteDTO; acceptedTurnId: string | null};
export type CompletePlaybackInput = GetPlayInput & {commandId: string; expectedExperienceRevision: number; turnId: string; mediaId: string};
export type PlayDTO = StoryProtocol & {inherited?:{savepointId:string;turnId:string;mediaId:string;duration:number};experienceId: string; title: string; revision: number; status: string;
 turn: {id: string; status: string; media: {id: string; duration: number} | null; errorCode: string | null} | null;
 interaction: {id: string; summary: string; choices: {id: string; title: string; text: string}[]} | null};
export function parseGenerationQuote(value: unknown): GenerationQuoteInput {
 if (value && typeof value === 'object' && 'kind' in value && value.kind === 'opening') return parseOpeningQuote(value);
 const protocol = generationProtocol(value);
 try {
  fields(value, ['protocolVersion', 'datasetId', 'commandId', 'experienceId', 'expectedExperienceRevision', 'kind', 'interactionEventId', 'text']);
  if (value.kind !== 'response' || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000) throw Error();
  return {...protocol, kind: 'response', commandId: parseId(value.commandId), experienceId: parseId(value.experienceId),
   expectedExperienceRevision: parseRevision(value.expectedExperienceRevision), interactionEventId: parseId(value.interactionEventId), text: value.text.trim()};
 } catch {throw Error('INVALID_GENERATION_COMMAND');}
}
export function parseGetPlay(value: unknown): GetPlayInput {
 const protocol = generationProtocol(value, true);
 try {fields(value, ['protocolVersion', 'datasetId', 'experienceId']); return {...protocol, experienceId: parseId(value.experienceId)};}
 catch {throw Error('INVALID_GENERATION_QUERY');}
}
export function parseGetQuote(value: unknown): GetQuoteInput {
 const protocol = generationProtocol(value, true);
 try {fields(value, ['protocolVersion', 'datasetId', 'experienceId', 'quoteId']);return {...protocol, experienceId: parseId(value.experienceId), quoteId: parseId(value.quoteId)};}
 catch {throw Error('INVALID_GENERATION_QUERY');}
}
export function parseCompletePlayback(value: unknown): CompletePlaybackInput {
 const protocol = generationProtocol(value);
 try {
  fields(value, ['protocolVersion', 'datasetId', 'commandId', 'experienceId', 'expectedExperienceRevision', 'turnId', 'mediaId']);
  return {...protocol, commandId: parseId(value.commandId), experienceId: parseId(value.experienceId), expectedExperienceRevision: parseRevision(value.expectedExperienceRevision), turnId: parseId(value.turnId), mediaId: parseId(value.mediaId)};
 } catch {throw Error('INVALID_GENERATION_COMMAND');}
}

function generationProtocol(value: unknown, query = false): StoryProtocol {
 try {return parseProtocol(value);} catch (error) {
  if (error instanceof Error && error.message === 'CLIENT_RELOAD_REQUIRED') throw error;
  throw Error(query ? 'INVALID_GENERATION_QUERY' : 'INVALID_GENERATION_COMMAND');
 }
}

export type GetResponseDraftInput = GetPlayInput & {interactionEventId: string};
export type ResponseDraftDTO = GetResponseDraftInput & {revision: number; text: string};
export type SaveResponseDraftInput = GetResponseDraftInput & {commandId: string; expectedDraftRevision: number; text: string};
export function parseGetResponseDraft(value: unknown): GetResponseDraftInput {
 const protocol = generationProtocol(value, true);
 try {fields(value, ['protocolVersion','datasetId','experienceId','interactionEventId']);return {...protocol, experienceId:parseId(value.experienceId),interactionEventId:parseId(value.interactionEventId)};}
 catch {throw Error('INVALID_GENERATION_QUERY');}
}
export function parseSaveResponseDraft(value: unknown): SaveResponseDraftInput {
 const protocol = generationProtocol(value);
 try {
  fields(value, ['protocolVersion','datasetId','experienceId','interactionEventId','commandId','expectedDraftRevision','text']);
  if(typeof value.text!=='string'||value.text.length>2000)throw Error();
  return {...protocol,experienceId:parseId(value.experienceId),interactionEventId:parseId(value.interactionEventId),commandId:parseId(value.commandId),expectedDraftRevision:parseRevision(value.expectedDraftRevision),text:value.text};
 }catch {throw Error('INVALID_GENERATION_COMMAND');}
}
export function parseResponseDraft(value: unknown): ResponseDraftDTO {
 try {
  fields(value,['protocolVersion','datasetId','experienceId','interactionEventId','revision','text']);
  if(typeof value.text!=='string'||value.text.length>2000)throw Error();
  return {...parseProtocol(value),experienceId:parseId(value.experienceId),interactionEventId:parseId(value.interactionEventId),revision:parseRevision(value.revision),text:value.text};
 }catch {throw Error('INVALID_GENERATION_DTO');}
}

export type BeginPlaybackInput = CompletePlaybackInput;
export type PlaybackSessionDTO = GetPlayInput & {id:string;turnId:string;mediaId:string;experienceRevision:number;durationMs:number;coveredMs:number;sequence:number;status:'active'|'complete';expiresAt:string};
export type PlaybackProgressInput = GetPlayInput & {commandId:string;playbackSessionId:string;sequence:number;positionMs:number;coveredMs:number};
export function parsePlaybackProgress(value:unknown):PlaybackProgressInput {
 const protocol=generationProtocol(value);
 try {
  fields(value,['protocolVersion','datasetId','experienceId','commandId','playbackSessionId','sequence','positionMs','coveredMs']);
  for(const key of ['positionMs','coveredMs'])if(typeof value[key]!=='number'||!Number.isSafeInteger(value[key])||(value[key] as number)<0||(value[key] as number)>120250)throw Error();
  return {...protocol,experienceId:parseId(value.experienceId),commandId:parseId(value.commandId),playbackSessionId:parseId(value.playbackSessionId),sequence:parseRevision(value.sequence),positionMs:value.positionMs as number,coveredMs:value.coveredMs as number};
 }catch{throw Error('INVALID_GENERATION_COMMAND');}
}
export function parsePlaybackSession(value:unknown):PlaybackSessionDTO {
 try {
  fields(value,['protocolVersion','datasetId','experienceId','id','turnId','mediaId','experienceRevision','durationMs','coveredMs','sequence','status','expiresAt']);
  if(!['active','complete'].includes(value.status as string)||typeof value.durationMs!=='number'||!Number.isSafeInteger(value.durationMs)||value.durationMs<1||value.durationMs>120250||
    typeof value.coveredMs!=='number'||!Number.isSafeInteger(value.coveredMs)||value.coveredMs<0||value.coveredMs>value.durationMs||
    typeof value.sequence!=='number'||!Number.isSafeInteger(value.sequence)||value.sequence<0||value.sequence>2147483647||
    typeof value.expiresAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.expiresAt)||!Number.isFinite(Date.parse(value.expiresAt)))throw Error();
  if(value.status==='complete'&&value.coveredMs<value.durationMs-250)throw Error();
  return {...parseProtocol(value),experienceId:parseId(value.experienceId),id:parseId(value.id),turnId:parseId(value.turnId),mediaId:parseId(value.mediaId),experienceRevision:parseRevision(value.experienceRevision),durationMs:value.durationMs,coveredMs:value.coveredMs,sequence:value.sequence,status:value.status as 'active'|'complete',expiresAt:value.expiresAt};
 }catch{throw Error('INVALID_GENERATION_DTO');}
}
