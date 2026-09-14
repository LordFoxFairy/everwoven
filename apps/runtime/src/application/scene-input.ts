import type {GenerationContext} from './generation-worker.js';
export const SCENE_TEXT_LIMIT=65536;
type Input=Pick<GenerationContext,'story'|'quote'|'action'|'parentSummary'|'confirmedScenes'>;
/** Shared by quote admission and the actual director request; no silent history truncation. */
export function buildSceneInput(context:Input){
 return{story:{title:context.story.title,settings:context.story.settings,character:context.story.mainCharacter?.effective??null},confirmedPast:context.parentSummary,confirmedScenes:context.confirmedScenes??[],userAction:context.action,
  output:{duration:context.quote.summary.duration,resolution:context.quote.summary.resolution,ratio:context.quote.summary.ratio,audio:context.quote.summary.audio}};
}
export function assertSceneInputFits(context:Input,validatorImageLimit:number){
 const input=buildSceneInput(context);
 // All frame timestamps are nonnegative integers below 120000ms. Six digits is a conservative serialized upper bound.
 const validator={...input,sampledFrameTimesMs:Array.from({length:validatorImageLimit},()=>120000)};
 if(JSON.stringify(input).length>SCENE_TEXT_LIMIT||JSON.stringify(validator).length>SCENE_TEXT_LIMIT)throw Error('GENERATION_CONTEXT_LIMIT');
}
