import type {Story} from '../../../../packages/domain/src/story';
import type {LiveVideoProvider,LiveVideoSession,VideoEvent,VideoOptions} from './types';

type IntentState='sent'|'accepted'|'generated'|'rejected';
export type LiveSnapshot={
 phase:'prepare'|'connecting'|'active'|'ending'|'ended'|'failed';
 ready:boolean;media:'waiting'|'playing'|'buffering';stream:MediaStream|null;error:string;
 intents:{id:string;text:string;state:IntentState}[];
 lastChunk?:{index:number;promptVersion:number;bufferSeconds?:number};
};

/** One controller per visit. No automatic reconnects or paid retries. */
export class SessionController {
 private snapshot:LiveSnapshot={phase:'prepare',ready:false,media:'waiting',stream:null,error:'',intents:[]};
 private listeners=new Set<()=>void>();
 private peer:LiveVideoSession|null=null;
 private opening:Promise<void>|null=null;
 private closing:Promise<void>|null=null;
 private stopping=false;
 constructor(private provider:LiveVideoProvider){}
 getSnapshot=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private patch(update:Partial<LiveSnapshot>){this.snapshot={...this.snapshot,...update};this.listeners.forEach(fn=>fn());}
 start(options:VideoOptions):Promise<void>{
  if(this.opening)return this.opening;
  if(this.snapshot.phase!=='prepare')return Promise.reject(Error('请结束本次连接后重新进入'));
  this.patch({phase:'connecting',error:''});
  this.opening=(async()=>{
   try{this.peer=await this.provider.open(options,this.receive);}
   catch{if(!this.stopping)this.patch({phase:'failed',ready:false,error:'启动失败。请返回检查接入配置后再试。'});}
  })();
  return this.opening;
 }
 private receive=(event:VideoEvent)=>{
  if(this.stopping||this.snapshot.phase==='ended'){
   if(event.type==='media')event.stream.getTracks().forEach(track=>track.stop());
   return;
  }
  if(event.type==='media'){
   if(this.snapshot.stream!==event.stream)this.snapshot.stream?.getTracks().forEach(track=>track.stop());
   this.patch({stream:event.stream});
  }
  if(event.type==='state'){
   if(event.state==='ready'&&this.snapshot.phase!=='failed')this.patch({phase:'active',ready:true});
   if(event.state==='failed')this.patch({phase:'failed',ready:false,error:this.snapshot.error||'实时连接已中断，请结束后重新进入。'});
   if(event.state==='closed')this.patch({phase:this.snapshot.phase==='failed'?'failed':'ended',ready:false});
  }
  if(event.type==='error')this.patch({phase:'failed',ready:false,error:event.message});
  if(event.type==='buffering')this.patch({media:'buffering'});
  if(event.type==='chunk')this.patch({lastChunk:{index:event.index,promptVersion:event.promptVersion,bufferSeconds:event.bufferSeconds}});
  if(event.type==='intent'){
   const order={sent:0,accepted:1,generated:2,rejected:3};
   this.patch({intents:this.snapshot.intents.map(item=>item.id!==event.inputId||order[event.state]<order[item.state]?item:{...item,state:event.state})});
  }
 };
 markPlaying=()=>{if(!this.stopping&&this.snapshot.phase==='active')this.patch({media:'playing'});};
 markBuffering=()=>{if(!this.stopping&&this.snapshot.phase==='active')this.patch({media:'buffering'});};
 send(id:string,text:string){
  if(!this.peer||!this.snapshot.ready||this.snapshot.phase!=='active'||this.stopping)throw Error('现场尚未就绪，请稍等。');
  if(!id||!text.trim()||text.length>50000)throw Error('请输入 1–50000 个字符');
  if(this.snapshot.intents.some(item=>item.id===id))return;
  const before=this.snapshot.intents;
  this.patch({intents:[...before,{id,text:text.trim(),state:'sent'}]});
  try{this.peer.send(id,text);}catch(error){this.patch({intents:before});throw error;}
 }
 close():Promise<void>{
  if(this.closing)return this.closing;
  this.stopping=true;
  this.patch({phase:'ending',ready:false});
  this.closing=(async()=>{
   try{
    // If the provider module is still loading, wait for its handle and close it.
    await this.opening;
    await this.peer?.close();
    this.snapshot.stream?.getTracks().forEach(track=>track.stop());
    this.patch({phase:'ended',stream:null});
   }catch(error){this.patch({phase:'failed',error:'关闭未确认，请重试结束，并检查服务端会话。'});throw error;}
  })();
  void this.closing.catch(()=>{this.closing=null;});
  return this.closing;
 }
}

export function buildOpeningPrompt(story:Story):string{
 return [
  '实时互动故事。用户是参与者，不是等待填写问题的观众。',
  `世界：${story.world}`,`角色：${story.character}。${story.personality}`,
  `外貌：${story.appearance||'保持首次生成的外貌一致'}`,
  `关系：${story.relationship||'不预设关系'}`,`表达习惯：${story.speakingStyle||'自然中文对白'}`,
  `边界：${story.boundaries||'尊重玩家的选择与个人边界'}`,
  `开场：${story.opening}`,
  '从开场直接演绎人物和环境，不等待用户第一句话，不显示菜单或文字输入框。',
  '人物可以自然邀请用户回应，但不要代替用户说话、决定情感或执行重大行动。',
  '没有新的玩家行动时保持当下情境的自然延续，不擅自跳过关键选择。',
  '后续玩家方向优先影响尚未生成的情节，保持人物、场景与声音连续。'
 ].join('\n');
}
