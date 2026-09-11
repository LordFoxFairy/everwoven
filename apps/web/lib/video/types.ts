export type VideoOptions = {prompt:string;aspectRatio:'9:16'|'16:9'|'1:1';resolution:'480p'|'768p'};
export type VideoEvent =
 | {type:'state';state:'connecting'|'ready'|'closed'|'failed'}
 | {type:'media';stream:MediaStream}
 | {type:'intent';inputId:string;state:'sent'|'accepted'|'generated'|'rejected'}
 | {type:'chunk';index:number;promptVersion:number;bufferSeconds?:number}
 | {type:'buffering'}
 | {type:'error';message:string};
export interface LiveVideoSession { send(inputId:string,text:string):void; close():Promise<void>; }
export interface LiveVideoProvider {
 id:string;label:string;
 providerId?:string;modelId?:string;
 capabilities:{audioOutput:boolean;voiceInput:boolean;cancelDirection:boolean};
 open(options:VideoOptions,onEvent:(event:VideoEvent)=>void):Promise<LiveVideoSession>;
}
