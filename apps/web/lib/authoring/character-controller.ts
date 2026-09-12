import {v7,validate,version} from 'uuid';
import type {AssetRef} from './asset-ports';
import type {CharacterDTO,CharacterCreate,CharacterUpdate,CharacterLifecycle} from '../../../runtime/src/contracts/character-template';
import {parseCreate,parseUpdate} from 'runtime/contracts/character-template-validation';
import type {CharacterClient} from './character-client';
import {characterFailure,characterFields,emptyCharacterFields,type CharacterFields} from './character-viewmodel';

type Command={kind:'create';input:CharacterCreate}|{kind:'update';input:CharacterUpdate}|{kind:'delete'|'restore';input:CharacterLifecycle};
type Binding={client:CharacterClient;connected:boolean;datasetId:string|null;invalidate:()=>void};
type State={portraitDatasetId:string|null;editInstance:string;fields:CharacterFields;confirmed:CharacterDTO|null;editing:boolean;dirty:boolean;busy:boolean;unknown:boolean;datasetChanged:boolean;connected:boolean;
 saving:boolean;reading:boolean;listBusy:boolean;items:CharacterDTO[];cursor:string|null;total:number;q:string;deleted:'exclude'|'only';listStatus:'idle'|'ready'|'error';error:string;listError:string;message:string};
const fingerprint=(fields:CharacterFields)=>JSON.stringify(fields);
const stopped=()=>Object.assign(Error('RESPONSE_SUPERSEDED'),{code:'RESPONSE_SUPERSEDED'});
/** In-memory commands only. Binding identity includes the exact session invalidator (its epoch). */
export class CharacterController{
 private editSequence=0;
 private state:State={portraitDatasetId:null,editInstance:'character:0',fields:{...emptyCharacterFields},confirmed:null,editing:false,dirty:false,busy:false,unknown:false,datasetChanged:false,connected:false,saving:false,reading:false,listBusy:false,items:[],cursor:null,total:0,q:'',deleted:'exclude',listStatus:'idle',error:'',listError:'',message:''};
 private baseline=fingerprint(emptyCharacterFields);private listeners=new Set<()=>void>();private binding:Binding|null=null;private epoch=0;private listRequest=0;private getRequest=0;
 private pending:Command|null=null;private attempt:{key:string;command:Command}|null=null;private flight:Promise<CharacterDTO>|null=null;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 getSnapshot=()=>this.state;
 get datasetId(){return this.binding?.datasetId??null;}
 private publish(patch:Partial<State>={}){const s={...this.state,...patch};s.dirty=s.datasetChanged||s.unknown||(s.editing&&fingerprint(s.fields)!==this.baseline);s.busy=s.saving||s.reading||s.listBusy;this.state=s;this.listeners.forEach(f=>f());}
 private needsRecovery(){return Boolean(this.pending||(this.state.editing&&(this.state.confirmed||fingerprint(this.state.fields)!==fingerprint(emptyCharacterFields))));}
 bind(next:Binding){
  const old=this.binding;if(old&&old.client===next.client&&old.connected===next.connected&&old.datasetId===next.datasetId&&old.invalidate===next.invalidate)return;
  this.epoch++;this.listRequest++;this.getRequest++;this.binding=next;this.flight=null;
  const changed=Boolean(old?.datasetId&&next.datasetId&&old.datasetId!==next.datasetId);
  if(changed)this.attempt=null;
  this.publish({connected:next.connected,saving:false,reading:false,listBusy:false,...(this.pending?{unknown:true}:{}),
   ...(changed?{datasetChanged:this.needsRecovery(),confirmed:null,items:[],cursor:null,total:0,listStatus:'idle' as const,error:'',message:''}:{})});
 }
 suspend(){this.epoch++;this.listRequest++;this.getRequest++;this.flight=null;this.publish({saving:false,reading:false,listBusy:false,...(this.pending?{unknown:true}:{})});}
 newDraft(fields:CharacterFields={...emptyCharacterFields}){if(this.state.busy||this.state.unknown||this.state.datasetChanged)return;this.pending=null;this.attempt=null;this.baseline=fingerprint(emptyCharacterFields);this.publish({editInstance:`character:${++this.editSequence}`,portraitDatasetId:fields.portraitAssetId?this.datasetId:null,fields:{...fields},confirmed:null,editing:true,error:'',message:''});}
 close(){if(this.state.busy||this.state.unknown||this.state.datasetChanged)return;this.baseline=fingerprint(emptyCharacterFields);this.publish({editInstance:`character:${++this.editSequence}`,portraitDatasetId:null,fields:{...emptyCharacterFields},confirmed:null,editing:false,error:'',message:''});}
 field(key:keyof CharacterFields,value:string|null){if(key==='portraitAssetId')return;this.attempt=null;this.publish({fields:{...this.state.fields,[key]:value},message:''});}
 selectPortrait(ref:AssetRef|null){
  const b=this.binding,s=this.state;
  if(!b?.connected||!s.connected||!s.editing||s.saving||s.reading||s.unknown||s.datasetChanged||s.confirmed?.deletedAt)return false;
  if(ref&&(ref.kind!=='formal'||ref.datasetId!==b.datasetId||!validate(ref.id)||version(ref.id)!==7))return false;
  this.attempt=null;this.publish({portraitDatasetId:ref?.kind==='formal'?ref.datasetId:null,fields:{...s.fields,portraitAssetId:ref?.id??null},message:''});return true;
 }
 fromRetained(){if(!this.state.connected||this.state.busy)return;this.pending=null;this.attempt=null;this.baseline=fingerprint(emptyCharacterFields);this.publish({editInstance:`character:${++this.editSequence}`,portraitDatasetId:this.state.datasetChanged?null:this.state.portraitDatasetId,fields:{...this.state.fields,...(this.state.datasetChanged?{portraitAssetId:null}:{})},unknown:false,datasetChanged:false,confirmed:null,editing:true,error:'',message:''});}
 private reset(){
  // Fence the old dataset synchronously; React's next binding is not the boundary.
  this.epoch++;this.getRequest++;this.listRequest++;this.flight=null;this.attempt=null;
  this.publish({connected:false,datasetChanged:this.needsRecovery(),confirmed:null,items:[],cursor:null,total:0,listStatus:'idle',message:'',saving:false,reading:false,listBusy:false,...(this.pending?{unknown:true}:{})});
 }
 async load(q=this.state.q,deleted=this.state.deleted,append=false){
  const binding=this.binding;if(!binding?.connected)return;const epoch=this.epoch,request=++this.listRequest;
  const current=()=>epoch===this.epoch&&request===this.listRequest;
  this.publish({listBusy:true,listError:''});
  try{const page=await binding.client.list({q,deleted,limit:20,...(append&&this.state.cursor?{cursor:this.state.cursor}:{})});if(!current())return;
   this.publish({items:[...new Map((append?[...this.state.items,...page.items]:page.items).map(x=>[x.id,x])).values()],cursor:page.nextCursor,total:page.totalMatching,q,deleted,listStatus:'ready'});
  }catch(error){if(current()){this.publish({listStatus:'error',listError:'角色列表读取失败；已载入内容仍保留，请重试。'});const info=characterFailure(error);if(info.denied||info.reset){if(info.reset)this.reset();binding.invalidate();}}}
  finally{if(current())this.publish({listBusy:false});}
 }
 async open(id:string){
  const binding=this.binding;if(!binding?.connected||this.state.saving||this.state.unknown||this.state.datasetChanged)return;
  const epoch=this.epoch,request=++this.getRequest,current=()=>epoch===this.epoch&&request===this.getRequest;this.publish({reading:true,error:'',message:''});
  try{const dto=await binding.client.get(id);if(!current())return;this.attempt=null;this.baseline=fingerprint(characterFields(dto));this.publish({editInstance:`character:${++this.editSequence}`,portraitDatasetId:dto.portraitAssetId?binding.datasetId:null,confirmed:dto,fields:characterFields(dto),editing:true});}
  catch(error){if(current()){const info=characterFailure(error);this.publish({error:info.denied||info.reset?info.message:'角色读取失败，原输入仍保留；请重试读取。'});if(info.reset)this.reset();if(info.denied||info.reset)binding.invalidate();}}
  finally{if(current())this.publish({reading:false});}
 }
 saveCopy(fields:CharacterFields):Promise<CharacterDTO>{
  if(this.flight)return this.flight;if(this.state.unknown)return this.confirm();
  if(this.state.busy||this.state.datasetChanged||!this.state.connected)return Promise.reject(Error('角色副本暂不可提交，请先完成连接或当前操作。'));
  this.newDraft(fields);return this.save();
 }
 save():Promise<CharacterDTO>{
  if(this.flight)return this.flight;if(this.state.unknown)return this.confirm();
  const b=this.binding;if(!b?.connected||!this.state.connected||!b.datasetId||this.state.datasetChanged)return Promise.reject(Error('请先连接当前数据集；重置后须显式新建。'));
  if(this.state.confirmed?.deletedAt)return Promise.reject(Error('请先恢复角色。'));
  try{const {name,portraitAssetId,...settings}=this.state.fields;const confirmed=this.state.confirmed;
   const content={name,settings:{...settings},portraitAssetId},payload=confirmed?{datasetId:b.datasetId,id:confirmed.id,expectedRevision:confirmed.revision,patch:content}:{datasetId:b.datasetId,...content};
   const key=JSON.stringify(payload);let command=this.attempt?.key===key?this.attempt.command:null;
   if(!command){command=confirmed?{kind:'update',input:parseUpdate({...payload,commandId:v7()} as CharacterUpdate)}:{kind:'create',input:parseCreate({...payload,commandId:v7()} as CharacterCreate)};this.attempt={key,command};}
   return this.execute(command);
  }catch(error){this.publish({error:'请填写角色姓名（最多120个字符），并检查各项文字长度。'});return Promise.reject(error);}
 }
 confirm():Promise<CharacterDTO>{if(this.flight)return this.flight;if(!this.pending||this.state.datasetChanged||!this.binding?.connected)return Promise.reject(Error('原命令暂不可确认。'));return this.execute(this.pending,true);}
 lifecycle(kind:'delete'|'restore'):Promise<CharacterDTO>{
  if(this.flight)return this.flight;const dto=this.state.confirmed,b=this.binding;
  if(!dto||!b?.connected||!b.datasetId||this.state.unknown||this.state.datasetChanged)return Promise.reject(Error('当前角色暂不可修改。'));
  const payload={datasetId:b.datasetId,id:dto.id,expectedRevision:dto.revision},key=JSON.stringify([kind,payload]);
  const command=this.attempt?.key===key?this.attempt.command:{kind,input:{...payload,commandId:v7()}};this.attempt={key,command};return this.execute(command);
 }
 private execute(command:Command,confirming=false):Promise<CharacterDTO>{
  const binding=this.binding!;if(command.input.datasetId!==binding.datasetId){this.reset();return Promise.reject(Error('DATASET_CHANGED'));}
  const epoch=this.epoch,current=()=>epoch===this.epoch&&this.pending===command;
  // Install the lock before publishing or invoking a transport that may throw synchronously.
  let resolve!:(dto:CharacterDTO)=>void,reject!:(error:unknown)=>void;
  const task=new Promise<CharacterDTO>((yes,no)=>{resolve=yes;reject=no;});this.flight=task;
  this.pending=command;this.publish({saving:true,error:'',message:''});
  void (async()=>{try{
   const response=command.kind==='create'?await binding.client.create(command.input):command.kind==='update'?await binding.client.update(command.input):await binding.client[command.kind](command.input);
   if(!current())throw stopped();const dto=response.data;
   // Never replace working text with a response. Baseline is the acknowledged payload.
   this.baseline=fingerprint(characterFields(dto));this.pending=null;this.attempt=null;
   this.publish({confirmed:dto,unknown:false,message:confirming?'原命令已确认；后续修改尚需保存。':dto.deletedAt?'角色已删除，可在回收列表恢复。':'角色模板已保存到本机 SQLite。',saving:false});
   void this.load();return dto;
  }catch(error){if(current()){const info=characterFailure(error);
    // A later pre-receipt rejection cannot settle a lost response or a scope-fenced write.
    const unknown=this.state.unknown||info.reset||!info.definitive;
    if(!unknown)this.pending=null;this.publish({unknown,error:info.message,saving:false});if(info.reset)this.reset();if(info.denied||info.reset)binding.invalidate();}
   throw error;
  }finally{if(epoch===this.epoch){this.flight=null;this.publish({saving:false});}}})().then(resolve,reject);return task;
 }
}
