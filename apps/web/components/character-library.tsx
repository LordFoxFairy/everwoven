'use client';
import {createEntityId} from '../../../packages/domain/src/id';
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Plus,ArrowUpRight,Pencil,Check} from 'lucide-react';
import type {Character} from './storage';
import {ImageAssetPicker,CharacterPortrait,useImageUpload} from './story-assets';
import {CharacterController} from '../lib/authoring/character-controller';
import {characterSelection,demoCharacterSelection,type CharacterSelection,type PendingState} from '../lib/authoring/character-viewmodel';
import styles from './character-library.module.css';

type Props={onUse:(c:CharacterSelection)=>void;onPendingChange:(state:PendingState)=>void}&({controller:CharacterController;characters?:never;onSave?:never}|{controller?:never;characters:Character[];onSave:(c:CharacterSelection)=>Promise<CharacterSelection>});
const blank=():Character=>({id:createEntityId(),name:'',personality:'',appearance:'',speakingStyle:'',boundaries:''});
function useProtection(pending:PendingState,callback:(s:PendingState)=>void){
 const ref=useRef(callback);ref.current=callback;
 useEffect(()=>{ref.current(pending);},[pending.dirty,pending.busy,pending.unknown]);
 useEffect(()=>()=>ref.current({dirty:false,busy:false}),[]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(pending.dirty||pending.busy||pending.unknown){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[pending.dirty,pending.busy,pending.unknown]);
}
export function CharacterLibrary(props:Props){return props.controller?<FormalLibrary {...props} controller={props.controller}/>:<DemoLibrary {...props} characters={props.characters!} onSave={props.onSave!}/>;}
function Heading({begin,busy}:{begin:()=>void;busy:boolean}){return <div className="page-heading"><div><p className="eyebrow">PEOPLE MAKE THE STORY</p><h1>角色库</h1><p>保留 TA 的性格与模样。每个故事里的关系，由你重新定义。</p></div><button className="primary" disabled={busy} onClick={begin}><Plus size={16}/>创建角色</button></div>;}
function Fields({draft,field,disabled=false}:{draft:Pick<Character,'name'|'personality'|'appearance'|'speakingStyle'|'boundaries'>;field:(key:'name'|'personality'|'appearance'|'speakingStyle'|'boundaries',value:string)=>void;disabled?:boolean}){
 return <fieldset className={styles.fields} disabled={disabled}>
 <label><span>角色姓名 <span aria-hidden="true">*</span></span><input aria-label="角色姓名" required value={draft.name} onChange={e=>field('name',e.target.value)} placeholder="TA 叫什么？"/><small>最多120个 Unicode 字符</small></label>
 <label>性格与背景<textarea rows={4} value={draft.personality} onChange={e=>field('personality',e.target.value)} placeholder="可留空，慢慢了解 TA"/></label>
 <label>外貌与穿着<textarea rows={2} value={draft.appearance??''} onChange={e=>field('appearance',e.target.value)}/></label>
 <label>表达习惯<textarea rows={2} value={draft.speakingStyle??''} onChange={e=>field('speakingStyle',e.target.value)}/></label>
 <label>相处边界<textarea rows={2} value={draft.boundaries??''} onChange={e=>field('boundaries',e.target.value)}/></label>
 </fieldset>;
}
function Cards({characters,formal,busy,edit,use}:{characters:CharacterSelection[];formal:boolean;busy:boolean;edit:(c:CharacterSelection)=>void;use:(c:CharacterSelection)=>void}){
 return <div className={styles.cards}>{characters.map(c=><article key={c.id} className={styles.card}>
 <CharacterPortrait character={c} assetRef={c.portraitRef}/>
 <div className={styles.cardBody}><h2>{c.name}</h2><p>{c.personality||'角色设定仍可继续完善'}</p><small>{c.appearance||'外貌由文字与故事共同定义'}</small><div>
 <button className="text-button" aria-label={`编辑 ${c.name}`} disabled={busy} onClick={()=>edit(c)}><Pencil size={14}/>编辑</button>
 <button className="secondary" aria-label={`用 ${c.name} 创作`} disabled={busy} onClick={()=>use(c)}>用 TA 创作<ArrowUpRight size={14}/></button>
 </div></div></article>)}</div>;
}
function FormalLibrary({controller,onUse,onPendingChange}:Props&{controller:CharacterController}){
 const s=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot),[query,setQuery]=useState(''),[readId,setReadId]=useState<string|null>(null);
 const image=useImageUpload(s.editInstance,ref=>controller.selectPortrait(ref)),imageState=image.state;
 const [localImageBusy,setLocalImageBusy]=useState(false);
 const imageBlocked=()=>{const state=image.controller.getSnapshot();return state.busy||state.unknown||state.datasetChanged||localImageBusy;};
 const recovering=s.datasetChanged||imageState.datasetChanged;
 useProtection({dirty:s.dirty,busy:s.saving||s.reading||imageState.busy||localImageBusy,...(s.unknown||recovering||imageState.unknown?{unknown:true}:{})},onPendingChange);
 useEffect(()=>image.controller.subscribe(()=>{const a=image.controller.getSnapshot(),c=controller.getSnapshot();onPendingChange({dirty:c.dirty,busy:c.saving||c.reading||a.busy,...(c.unknown||c.datasetChanged||a.unknown||a.datasetChanged?{unknown:true}:{})});}),[image.controller,controller,onPendingChange]);
 function mayDiscard(){const current=controller.getSnapshot();if(current.saving||current.reading||imageBlocked())return false;if(current.unknown||current.datasetChanged)return false;return !current.dirty||confirm('放弃当前未保存的角色修改？');}
 const begin=()=>{if(mayDiscard())controller.newDraft();};
 const attempt=(work:Promise<unknown>)=>{void work.catch(()=>{});};
 const read=(id:string)=>{if(!mayDiscard())return;setReadId(id);void controller.open(id);};
 // The controller carries dataset identity, never infer it from a browser draft ID.
 const cards=s.items.map(dto=>characterSelection(dto,controller.datasetId??''));
 return <><Heading begin={begin} busy={s.busy||imageState.busy||imageState.unknown||recovering}/><p className={styles.hint}>正式角色只保存到本机 SQLite，不读取浏览器角色或图片。姓名是唯一必填项。</p>
 {recovering&&<div className={styles.warning} role="alert"><p>数据已重置，原命令停止重放；工作文本仍保留。</p><button className="secondary" disabled={s.busy||!s.connected||imageState.busy||localImageBusy} onClick={()=>{if(image.controller.discardForDatasetChange())controller.fromRetained();}}>从保留文本新建角色</button></div>}
 {!s.connected&&<p role="status">请在上方连接本机，当前编辑内容仍保留。</p>}
 <form className={styles.filters} aria-label="筛选角色" onSubmit={e=>{e.preventDefault();void controller.load(query,s.deleted);}}>
 <label>搜索角色<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary" disabled={!s.connected||s.listBusy}>搜索</button>
 <button type="button" className="text-button" aria-pressed={s.deleted==='exclude'} disabled={!s.connected||s.listBusy} onClick={()=>void controller.load(query,'exclude')}>有效角色</button>
 <button type="button" className="text-button" aria-pressed={s.deleted==='only'} disabled={!s.connected||s.listBusy} onClick={()=>void controller.load(query,'only')}>回收站</button>
 <button type="button" className="text-button" disabled={!s.connected||s.listBusy} onClick={()=>void controller.load()}>刷新角色</button>
 </form>
 {s.listBusy&&<p role="status">正在读取角色列表…</p>}{s.listError&&<div role="alert">{s.listError}<button onClick={()=>void controller.load(query,s.deleted)}>重试列表</button></div>}
 {s.listStatus==='ready'&&<p className={styles.hint}>匹配 {s.total} 个角色 · 已载入 {s.items.length} 个</p>}
 <div className={styles.layout}><section className={styles.library} aria-label="已保存角色">
 {s.items.length>0&&<Cards characters={cards} formal busy={s.busy||s.unknown||recovering||imageState.busy||imageState.unknown} edit={c=>read(c.id)} use={c=>{if(mayDiscard())onUse(c);}}/>}
 {s.listStatus==='ready'&&!s.items.length&&<div className="empty"><h3>{s.q?'没有匹配的角色':s.deleted==='only'?'暂无已删除角色':'先认识一个人'}</h3><p>可以只写姓名，其他设定稍后完善。</p></div>}
 {s.cursor&&<button className="secondary" disabled={s.listBusy||!s.connected} onClick={()=>void controller.load(s.q,s.deleted,true)}>加载更多角色</button>}
 </section>
 {s.editing&&<form aria-label="角色编辑" className={styles.form} onSubmit={e=>{e.preventDefault();if(!imageBlocked())attempt(controller.save());}}>
 <header><div><small>{s.confirmed?'编辑角色模板':'新的相遇'}</small><h2>{s.fields.name||'定义 TA 的模样'}</h2></div><button type="button" className="text-button" disabled={s.busy||s.unknown||recovering||imageState.busy||imageState.unknown} onClick={()=>{if(mayDiscard())controller.close();}}>收起</button></header>
 <Fields draft={s.fields} field={(key,value)=>controller.field(key,value)} disabled={s.reading||Boolean(s.confirmed?.deletedAt)}/>
 <ImageAssetPicker role="character" assetRef={s.fields.portraitAssetId&&s.portraitDatasetId?{kind:'formal',datasetId:s.portraitDatasetId,id:s.fields.portraitAssetId}:null} upload={image} onChange={ref=>controller.selectPortrait(ref)} onBusyChange={setLocalImageBusy} disabled={s.saving||s.reading||s.unknown||recovering||Boolean(s.confirmed?.deletedAt)}/>
 <p role="status">{s.saving?'正在保存提交的版本…':s.dirty?'有未保存修改':s.confirmed?`已确认 · 修订 ${s.confirmed.revision}`:'尚未创建'}</p>
 {!recovering&&(s.unknown?<button type="button" className="primary" disabled={s.busy||!s.connected||imageState.busy||imageState.unknown||localImageBusy} onClick={()=>attempt(controller.confirm())}>确认上次角色命令</button>:s.confirmed?.deletedAt?<button type="button" className="primary" disabled={s.busy||!s.connected||imageState.busy||imageState.unknown||localImageBusy} onClick={()=>attempt(controller.lifecycle('restore'))}>恢复角色</button>:<button type="submit" className="primary" disabled={s.busy||!s.connected||imageState.busy||imageState.unknown||localImageBusy}><Check size={16}/>保存角色模板</button>)}
 {s.confirmed&&!s.unknown&&!recovering&&<><button type="button" className="text-button" disabled={s.busy||!s.connected||imageState.busy||imageState.unknown||localImageBusy} onClick={()=>read(s.confirmed!.id)}>重新载入角色</button>{!s.confirmed.deletedAt&&<button type="button" className="text-button" disabled={s.busy||!s.connected||imageState.busy||imageState.unknown||localImageBusy} onClick={()=>{if(confirm('删除这个角色模板？已有剧本与固定版本不改变。'))attempt(controller.lifecycle('delete'));}}>删除角色</button>}</>}
 {s.message&&<p role="status" className={styles.hint}>{s.message}</p>}
 </form>}</div>
 {s.error&&!s.datasetChanged&&<div role="alert">{s.error}{readId&&!s.unknown&&<button disabled={s.busy||!s.connected||imageState.busy||imageState.unknown||localImageBusy} onClick={()=>read(readId)}>重试读取</button>}</div>}
 {s.unknown&&!s.datasetChanged&&<p role="status">上次角色命令结果待确认；仅确认原提交，不自动重发当前输入。</p>}
 </>;
}
function DemoLibrary({characters,onSave,onUse,onPendingChange}:{characters:Character[];onSave:(c:CharacterSelection)=>Promise<CharacterSelection>;onUse:(c:CharacterSelection)=>void;onPendingChange:(s:PendingState)=>void}){
 const [draft,setDraft]=useState<Character|null>(null),[saved,setSaved]=useState(''),[imageBusy,setImageBusy]=useState(false),[saveBusy,setSaveBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const image=useImageUpload(draft?.id??'demo-closed',ref=>setDraft(prev=>prev?{...prev,imageAssetId:ref?.kind==='demo'?ref.id:undefined}:prev));
 const busy=imageBusy||saveBusy||image.state.busy,dirty=!!draft&&JSON.stringify(draft)!==saved;useProtection({dirty,busy},onPendingChange);
 function mayDiscard(){return !busy&&!lock.current&&(!dirty||confirm('放弃当前未保存的角色修改？'));}
 function begin(c?:Character){if(!mayDiscard())return;const {portraitRef,source,...next}=demoCharacterSelection(c?structuredClone(c):blank());setDraft(next);setSaved(JSON.stringify(next));setMessage('');}
 async function save(){if(!draft||lock.current||imageBusy)return;const next=demoCharacterSelection(structuredClone(draft));
  if(!next.name.trim()||[...next.name].length>120||[...next.personality].length>8000||[...(next.appearance??'')].length>4000||[...(next.speakingStyle??'')].length>2000||[...(next.boundaries??'')].length>4000){setMessage('请检查角色姓名及文字长度。');return;}
  lock.current=true;setSaveBusy(true);setMessage('');try{const confirmed=await onSave(next);if(alive.current){const {portraitRef,source,...savedFields}=next;setSaved(JSON.stringify(savedFields));setMessage('角色模板已保存到当前浏览器；后续修改仍需保存。');}}
  catch{if(alive.current)setMessage('角色保存失败，输入仍保留，请重试。');}finally{lock.current=false;if(alive.current)setSaveBusy(false);}
 }
 return <><Heading begin={()=>begin()} busy={busy}/><div className={styles.layout}><section className={styles.library} aria-label="已保存角色">
 {characters.length?<Cards characters={characters.map(demoCharacterSelection)} formal={false} busy={busy} edit={begin} use={c=>{if(mayDiscard())onUse(c);}}/>:<div className="empty"><h3>先认识一个人</h3><p>姓名足以保存草稿，设定与图片可以慢慢补充。</p>{!draft&&<button className="secondary" onClick={()=>begin()}>创建第一个角色</button>}</div>}
 </section>{draft&&<form aria-label="角色编辑" className={styles.form} onSubmit={e=>{e.preventDefault();void save();}}><header><h2>{draft.name||'定义 TA 的模样'}</h2><button type="button" className="text-button" disabled={busy} onClick={()=>{if(mayDiscard())setDraft(null);}}>收起</button></header>
 <Fields draft={draft} field={(key,value)=>setDraft(prev=>prev?{...prev,[key]:value}:prev)}/>
 <ImageAssetPicker role="character" assetRef={draft.imageAssetId?{kind:'demo',id:draft.imageAssetId}:null} upload={image} onChange={ref=>setDraft(prev=>prev?{...prev,imageAssetId:ref?.kind==='demo'?ref.id:undefined}:prev)} onBusyChange={setImageBusy} disabled={saveBusy}/>
 <p className={styles.hint}>演练角色与图片只保存到当前浏览器。复制到剧本后独立编辑。</p><button type="submit" className="primary" disabled={busy}>{saveBusy?'保存中…':imageBusy?'图片处理中…':'保存角色模板'}</button>
 {message&&<p role="status" className={styles.hint}>{message}</p>}</form>}</div></>;
}
