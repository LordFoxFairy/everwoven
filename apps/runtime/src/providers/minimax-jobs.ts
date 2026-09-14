import {createHash} from 'node:crypto';
import {validateMiniMaxBinding, minimaxEndpoints} from './minimax-capabilities.js';
import {canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {isBusinessId, isTimestamp} from '../contracts/primitives.js';
import {fields} from '../contracts/story-draft-validation.js';
import {buildMiniMaxRequest,type MiniMaxModel,type MiniMaxRequestInput,type MiniMaxRatio} from './minimax-request.js';

import type {VideoJobAdapter, VideoJobSnapshot, VideoTaskReference, PreparedVideoInput, VideoPlanInput} from '../ports/video-jobs.js';
type ErrorCode='not-submitted'|'submission-unknown'|'invalid-response'|'query-unavailable';
export class OfficialJobError extends Error {
 constructor(readonly code:ErrorCode,message:string,readonly submission:'not-submitted'|'unknown'|null=null,readonly httpStatus?:number){super(message);this.name='OfficialJobError';}
}
type Dependencies={apiKey:string;fetchImpl?:typeof fetch;timeoutMs?:number};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const finitePositive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const ratios:readonly string[]=['21:9','16:9','4:3','1:1','3:4','9:16'];
async function boundedJSON(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.body)throw Error();
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,complete=false;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done){complete=true;break;}
   size+=value.byteLength;if(size>262144)throw Error();chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{signal.removeEventListener('abort',abort);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Server-side integration primitive, not a public route or a budget controller.
 * Call only after ownership, media consent and server budget reservation checks.
 * No import-time calls, polling, paid retries, deletion or supplier fallbacks.
 */
export function createMiniMaxVideoJobs(raw:unknown,{apiKey,fetchImpl=fetch,timeoutMs=15000}:Dependencies):VideoJobAdapter{
 if(!raw||typeof raw!=='object')throw Error('INVALID_PROVIDER_BINDING');
 const {id,createdAt,...value}=raw as Record<string,unknown>,binding=validateMiniMaxBinding(value);
 if(!isBusinessId(id)||!(createdAt instanceof Date)||!isTimestamp(createdAt.toISOString()))throw Error('INVALID_PROVIDER_BINDING');
 const model=binding.modelId as MiniMaxModel,region=binding.parameters.region as 'cn'|'international';
 const base=minimaxEndpoints[region].origin;
 const bindingHash=createHash('sha256').update(JSON.stringify(canonicalBindingJson(binding))).digest('hex');
 const identity={providerId:binding.providerId,bindingId:id,bindingHash,connectionId:binding.parameters.connectionId,accountScopeId:binding.parameters.providerAccountScopeId,region,modelId:model};
 function reference(raw:unknown):VideoTaskReference{
  try{
   fields(raw,['providerId','operationId','taskId','bindingId','bindingHash','connectionId','accountScopeId','region','modelId','requestHash','firstSubmittedAt']);
   if(!isBusinessId(raw.operationId)||!validId(raw.taskId)||!isTimestamp(raw.firstSubmittedAt)||
    typeof raw.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(raw.requestHash)||
    Object.entries(identity).some(([k,v])=>raw[k]!==v))throw Error();
   return {...raw} as VideoTaskReference;
  }catch{throw Error('INVALID_PROVIDER_TASK_REFERENCE');}
 }
 if(typeof apiKey!=='string'||!apiKey.trim()||/[\r\n]/.test(apiKey))throw Error('服务端凭据未就绪');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw Error('请求等待上限无效');
 const key=apiKey.trim();
 async function request(method:'POST'|'GET',path:string,body?:string,signal?:AbortSignal):Promise<unknown>{
  const creating=method==='POST';
  if(signal?.aborted)throw new OfficialJobError(creating?'not-submitted':'query-unavailable','本次请求尚未发出',creating?'not-submitted':null);
  const deadline=AbortSignal.timeout(Math.ceil(timeoutMs));
  const bounded=signal?AbortSignal.any([signal,deadline]):deadline;
  try{
   const response=await fetchImpl(base+path,{
    method,body,signal:bounded,redirect:'error',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Cache-Control':'no-store'},
   });
   if(!response.ok){
    // A proxy/status alone cannot prove no billable job was accepted. Preserve uncertainty.
    await response.body?.cancel().catch(()=>{});
    throw new OfficialJobError(creating?'submission-unknown':'query-unavailable',
     creating?'提交结果尚未确认，未自动重复提交':'任务状态暂未查到，请稍后重新查询',creating?'unknown':null,response.status);
   }
   return await boundedJSON(response,bounded);
  }catch(error){
   if(error instanceof OfficialJobError)throw error;
   // Do not echo transport bodies, URLs, prompts, credentials or error causes.
   throw new OfficialJobError(creating?'submission-unknown':'query-unavailable',
    creating?'提交结果尚未确认，未自动重复提交':'查询暂时中断，原生成任务状态仍未知',creating?'unknown':null);
  }
 }
 function validatePrepared(raw:unknown):PreparedVideoInput{
  fields(raw,['prompt','duration','resolution','ratio'],['frames']);
  const input=raw as unknown as Omit<MiniMaxRequestInput,'model'>;
  const body=buildMiniMaxRequest({...input,model}),g=binding.parameters.generation;
  if(body.duration!==g.duration||body.resolution!==g.resolution||body.ratio!==g.ratio||
   (Boolean(input.frames)!==(binding.parameters.operationKind==='image-to-video')))throw Error('PREPARED_REQUEST_OUTSIDE_BINDING');
  return {prompt:input.prompt.trim(),duration:body.duration,resolution:body.resolution,ratio:body.ratio,
   ...(input.frames?{frames:{...input.frames}}:{})};
 }
 function prepare(input:VideoPlanInput):PreparedVideoInput{
  fields(input,['prompt'],['frames']);
  const g=binding.parameters.generation;
  return validatePrepared({prompt:input.prompt,...(Object.hasOwn(input,'frames')?{frames:input.frames}:{}),duration:g.duration,resolution:g.resolution,ratio:g.ratio});
 }
 return {
  mode:'job',bindingId:id,bindingHash,prepare,validatePrepared,reference,
  async submit(operationId:string,raw:unknown,signal?:AbortSignal):Promise<VideoTaskReference>{
   if(!isBusinessId(operationId))throw Error('INVALID_PROVIDER_OPERATION');
   const input=validatePrepared(raw);
   const body=buildMiniMaxRequest({...input,model} as MiniMaxRequestInput);
   const firstSubmittedAt=new Date().toISOString(),requestHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
   const response=record(await request('POST','/v2/video_generation',JSON.stringify(body),signal));
   if(!validId(response.task_id))throw new OfficialJobError('submission-unknown','返回的任务编号未确认，请先核对任务记录','unknown');
   return {...identity,operationId,taskId:response.task_id,firstSubmittedAt,requestHash};
  },
  async read(raw:unknown,signal?:AbortSignal):Promise<VideoJobSnapshot>{
   const ref=reference(raw),taskId=ref.taskId;
   if(Date.now()-Date.parse(ref.firstSubmittedAt)>7*86400000)throw new OfficialJobError('query-unavailable','供应商查询保留期已过，原任务责任仍需核对');
   const task=record(record(await request('GET',`/v2/query/video_generation/${encodeURIComponent(taskId)}`,undefined,signal)).task);
   const invalid=()=>new OfficialJobError('invalid-response','供应商任务结果尚未通过结构校验');
   if(task.id!==taskId||task.model!==model||task.task_type!=='generation'||task.modality!=='video'||typeof task.status!=='string'||!['queued','running','succeeded','failed','cancelled'].includes(task.status))throw invalid();
   const result:VideoJobSnapshot={taskId,status:task.status as VideoJobSnapshot['status']};
   if(task.status==='succeeded'){
    const content=record(task.content);
    let url:URL;try{if(typeof content.url!=='string'||content.url.length>8192)throw Error();url=new URL(content.url);}catch{throw invalid();}
    const resolutions=model==='MiniMax-H3'?['768P','2K']:['480P','768P'];
    if(url.protocol!=='https:'||url.username||url.password||typeof task.ratio!=='string'||!ratios.includes(task.ratio)||typeof task.resolution!=='string'||!resolutions.includes(task.resolution)||!finitePositive(task.duration))throw invalid();
    result.video={url:content.url as string,ratio:task.ratio as MiniMaxRatio,resolution:task.resolution as MiniMaxRequestInput['resolution'],duration:task.duration};
   }
   if(task.usage!==undefined){
    const usage=record(task.usage);const normalized:NonNullable<VideoJobSnapshot['usage']>={};
    for(const source of ['output_seconds','input_seconds','total_seconds','input_image_count','input_audio_seconds','total_tokens','prompt_tokens','completion_tokens'] as const){
     if(usage[source]===undefined)continue;
     const value=usage[source];if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw invalid();
     if(['input_image_count','total_tokens','prompt_tokens','completion_tokens'].includes(source)&&!Number.isSafeInteger(value))throw invalid();
     normalized[source]=value;
    }
    if(Object.keys(normalized).length)result.usage=normalized;
   }
   return result;
  },
 };
}
