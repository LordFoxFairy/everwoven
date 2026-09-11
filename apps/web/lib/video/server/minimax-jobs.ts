import {getDeployment,type ModelSelection} from '../catalog';
import {buildMiniMaxRequest,type MiniMaxModel,type MiniMaxRequestInput,type MiniMaxRatio} from '../minimax-request';

export type OfficialJobSnapshot={
 taskId:string;status:'queued'|'running'|'succeeded'|'failed'|'cancelled';
 video?:{url:string;ratio:MiniMaxRatio;resolution:MiniMaxRequestInput['resolution'];duration:number};
 usage?:{outputSeconds?:number;totalSeconds?:number};
};
type ErrorCode='not-submitted'|'submission-unknown'|'request-rejected'|'invalid-response'|'query-unavailable';
export class OfficialJobError extends Error {
 constructor(readonly code:ErrorCode,message:string,readonly submission:'not-submitted'|'unknown'|'rejected'|null=null,readonly httpStatus?:number){super(message);this.name='OfficialJobError';}
}
type Dependencies={apiKey:string;fetchImpl?:typeof fetch;timeoutMs?:number};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const finitePositive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const ratios:readonly string[]=['21:9','16:9','4:3','1:1','3:4','9:16'];
const base='https://api.minimax.cn';

/** Server-side integration primitive, not a public route or a budget controller.
 * Call only after ownership, media consent and server budget reservation checks.
 * No import-time calls, polling, paid retries, deletion or supplier fallbacks.
 */
export function createOfficialVideoJobs(selection:ModelSelection,{apiKey,fetchImpl=fetch,timeoutMs=15000}:Dependencies){
 if(typeof window!=='undefined')throw Error('官方任务适配器仅在服务端运行');
 const binding=getDeployment(selection.providerId,selection.modelId);
 if(binding.providerId!=='minimax'||binding.adapter!=='minimax-v2'||binding.mode!=='job')throw Error('供应商与模型不匹配');
 if(binding.endpoint!=='MiniMax-H3'&&binding.endpoint!=='MiniMax-H3-Max')throw Error('官方模型尚未适配');
 const model:MiniMaxModel=binding.endpoint;
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
    method,body,signal:bounded,redirect:'error',cache:'no-store',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
   });
   if(!response.ok){
    // Only documented definitive rejections are safe to classify as rejected.
    const rejected=creating&&[400,401,402,422,429].includes(response.status);
    throw new OfficialJobError(creating?(rejected?'request-rejected':'submission-unknown'):'query-unavailable',
     creating?(rejected?'供应商未接受本次请求，请检查配置与额度':'提交结果尚未确认，请核对任务记录后再操作'):'任务状态暂未查到，请稍后重新查询',
     creating?(rejected?'rejected':'unknown'):null,response.status);
   }
   return await response.json();
  }catch(error){
   if(error instanceof OfficialJobError)throw error;
   // Do not echo transport bodies, URLs, prompts, credentials or error causes.
   throw new OfficialJobError(creating?'submission-unknown':'query-unavailable',
    creating?'提交结果尚未确认，未自动重复提交':'查询暂时中断，原生成任务状态仍未知',creating?'unknown':null);
  }
 }
 return {
  mode:'job' as const,
  async submit(input:Omit<MiniMaxRequestInput,'model'>,signal?:AbortSignal):Promise<{taskId:string}>{
   if(!input||Object.hasOwn(input,'model'))throw Error('模型由已选供应商部署绑定');
   const body=buildMiniMaxRequest({...input,model});
   const response=record(await request('POST','/v2/video_generation',JSON.stringify(body),signal));
   if(!validId(response.task_id))throw new OfficialJobError('submission-unknown','返回的任务编号未确认，请先核对任务记录','unknown');
   return {taskId:response.task_id};
  },
  async read(taskId:string,signal?:AbortSignal):Promise<OfficialJobSnapshot>{
   if(!validId(taskId))throw Error('任务编号格式无效');
   const task=record(record(await request('GET',`/v2/query/video_generation/${encodeURIComponent(taskId)}`,undefined,signal)).task);
   const invalid=()=>new OfficialJobError('invalid-response','供应商任务结果尚未通过结构校验');
   if(task.id!==taskId||task.model!==model||typeof task.status!=='string'||!['queued','running','succeeded','failed','cancelled'].includes(task.status))throw invalid();
   const result:OfficialJobSnapshot={taskId,status:task.status as OfficialJobSnapshot['status']};
   if(task.status==='succeeded'){
    const content=record(task.content);
    let url:URL;try{if(typeof content.url!=='string')throw Error();url=new URL(content.url);}catch{throw invalid();}
    const resolutions=model==='MiniMax-H3'?['768P','2K']:['480P','768P'];
    if(url.protocol!=='https:'||url.username||url.password||typeof task.ratio!=='string'||!ratios.includes(task.ratio)||typeof task.resolution!=='string'||!resolutions.includes(task.resolution)||!finitePositive(task.duration))throw invalid();
    result.video={url:content.url as string,ratio:task.ratio as MiniMaxRatio,resolution:task.resolution as MiniMaxRequestInput['resolution'],duration:task.duration};
   }
   if(task.usage!==undefined){
    const usage=record(task.usage);const normalized:NonNullable<OfficialJobSnapshot['usage']>={};
    for(const [source,target] of [['output_seconds','outputSeconds'],['total_seconds','totalSeconds']] as const){
     if(usage[source]===undefined)continue;
     const value=usage[source];if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw invalid();
     normalized[target]=value;
    }
    if(Object.keys(normalized).length)result.usage=normalized;
   }
   return result;
  },
 };
}
