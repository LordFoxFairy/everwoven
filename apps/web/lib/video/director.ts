import type {LiveVideoProvider,LiveVideoSession,VideoEvent,VideoOptions} from './types';
export const DIRECTOR_ENDPOINT='minimax/h3-max/director';
export type Peer={send(message:Record<string,unknown>):void;close():void|Promise<void>};
export type Transport=(callbacks:{state:(state:string)=>void;data:(raw:unknown)=>void;media:(stream:MediaStream)=>void;error:()=>void})=>Peer;
export function openDirector(options:VideoOptions,emit:(event:VideoEvent)=>void,transport:Transport):LiveVideoSession{
 if(!options.prompt.trim()||options.prompt.length>50000)throw Error('世界描述需为 1–50000 个字符');
 if(!['9:16','16:9','1:1'].includes(options.aspectRatio)||!['480p','768p'].includes(options.resolution))throw Error('不支持的画面设置');
 let peer:Peer|undefined,ended=false,configured=false,ready=false,live=false,version=1;
 let closing:Promise<void>|undefined;
 let timeout:ReturnType<typeof setTimeout>|undefined;
 const ids=new Map<number,string>();const seenIds=new Set<string>();
 const publish=(event:VideoEvent)=>{if(!ended)emit(event);};
 const configure=()=>{if(peer&&live&&!configured&&!ended){configured=true;peer.send({type:'configure',protocol_version:1,prompt:options.prompt,prompt_version:1,resolution:options.resolution,aspect_ratio:options.aspectRatio,memory:12});}};
 emit({type:'state',state:'connecting'});
 peer=transport({
  state(state){if(ended)return;if(state==='live'){live=true;configure();}if(state==='closed'||state==='failed'){publish({type:'state',state});void close().catch(()=>{});}},
  media(stream){if(ended){stream.getTracks().forEach(track=>track.stop());return;}publish({type:'media',stream});},
  error(){publish({type:'error',message:'实时连接失败，请结束后重试。'});void close().catch(()=>{});},
  data(raw){if(ended)return;let message:Record<string,unknown>;try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;if(!parsed||typeof parsed!=='object')return;message=parsed as Record<string,unknown>;}catch{return;}
   if(message.type==='configured'){ready=true;publish({type:'state',state:'ready'});}
   if(message.type==='deadline_missed')publish({type:'buffering'});
   if(message.type==='chunk'&&Number.isInteger(message.chunk_index)&&Number.isInteger(message.prompt_version))publish({type:'chunk',index:message.chunk_index as number,promptVersion:message.prompt_version as number,bufferSeconds:typeof message.buffer_depth_seconds==='number'?message.buffer_depth_seconds:undefined});
   const id=typeof message.prompt_version==='number'?ids.get(message.prompt_version):undefined;
   if(id){if(message.type==='prompt_applied')publish({type:'intent',inputId:id,state:'accepted'});if(message.type==='chunk')publish({type:'intent',inputId:id,state:'generated'});if(message.type==='prompt_rejected')publish({type:'intent',inputId:id,state:'rejected'});}
   if(message.type==='error'){publish({type:'error',message:'生成服务返回错误，请结束后检查额度、内容或连接。'});void close().catch(()=>{});}
  }
 });
 configure();
 if(!ended)timeout=setTimeout(()=>{publish({type:'error',message:'本轮连接已达到本地两分钟上限，请结束后重新进入。'});void close().catch(()=>{});},120000);
 function close():Promise<void>{
  if(closing)return closing;
  ended=true;live=false;clearTimeout(timeout);
  closing=Promise.resolve().then(async()=>{
   // Defer until transport creation returns, including synchronous error callbacks.
   try{if(configured)peer?.send({type:'stop'});}catch{/* Still release the peer if the channel is already closed. */}
   await peer?.close();emit({type:'state',state:'closed'});
  });
  void closing.catch(()=>{closing=undefined;});
  return closing;
 }
 return {send(inputId,text){if(ended||!live||!ready)throw Error('连接尚未就绪');if(!inputId||!text.trim()||text.length>50000)throw Error('请输入 1–50000 个字符');if(seenIds.has(inputId))return;const next=version+1;ids.set(next,inputId);try{peer!.send({type:'prompt',prompt:text.trim(),prompt_version:next,replan:true});version=next;seenIds.add(inputId);publish({type:'intent',inputId,state:'sent'});}catch(error){ids.delete(next);throw error;}},close};
}
export function createDirectorModel(binding:{providerId:string;modelId:string;label:string;endpoint:string}):LiveVideoProvider{return {
 id:`${binding.providerId}/${binding.modelId}`,providerId:binding.providerId,modelId:binding.modelId,label:binding.label,
 capabilities:{audioOutput:true,voiceInput:false,cancelDirection:false},
 async open(options,emit){const [{createFalClient},{wma}]=await Promise.all([import('@fal-ai/client'),import('@fal-ai/client/realtime')]);const client=createFalClient({proxyUrl:'/api/fal/proxy'});return openDirector(options,emit,callbacks=>client.realtime.open(wma(binding.endpoint),{receive:['video','audio'],onState:callbacks.state,onData:callbacks.data,onMedia:callbacks.media,onError:callbacks.error}));}
};}
