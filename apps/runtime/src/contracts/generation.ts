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
export type CompletePlaybackInput = GetPlayInput & {commandId: string; expectedExperienceRevision: number; turnId: string; mediaId: string};
export type PlayDTO = StoryProtocol & {experienceId: string; title: string; revision: number; status: string;
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
