'use client';
import {createEntityId} from '../../../packages/domain/src/id';

import {useEffect,useState} from 'react';
import {Plus,ArrowUpRight,Pencil,Check} from 'lucide-react';
import type {Character} from './storage';
import {ImageAssetPicker,CharacterPortrait} from './story-assets';
import styles from './character-library.module.css';
function blank():Character{return {id:createEntityId(),name:'',personality:'',appearance:'',speakingStyle:'',boundaries:''};}
export function CharacterLibrary({characters,onSave,onUse,onPendingChange}:{characters:Character[];onSave:(c:Character)=>boolean;onUse:(c:Character)=>void;onPendingChange:(state:{dirty:boolean;busy:boolean})=>void}){
 const [draft,setDraft]=useState<Character|null>(null),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const dirty=!!draft&&JSON.stringify(draft)!==saved;
 useEffect(()=>{onPendingChange({dirty,busy});},[dirty,busy,onPendingChange]);
 useEffect(()=>()=>onPendingChange({dirty:false,busy:false}),[onPendingChange]);
 useEffect(()=>{function warn(e:BeforeUnloadEvent){if(dirty||busy)e.preventDefault();}window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,busy]);
 function begin(c?:Character){if(busy||(dirty&&!confirm('放弃当前未保存的角色修改？')))return;const next=c?structuredClone(c):blank();setDraft(next);setSaved(JSON.stringify(next));setMessage('');}
 function field(key:keyof Character,value:string){setDraft(prev=>prev?{...prev,[key]:value}:prev);}
 return <><div className="page-heading"><div><p className="eyebrow">PEOPLE MAKE THE STORY</p><h1>角色库</h1><p>保留 TA 的性格与模样。每个故事里的关系，由你重新定义。</p></div><button className="primary" disabled={busy} onClick={()=>begin()}><Plus size={16}/>创建角色</button></div>
 <div className={styles.layout}>
 <section className={styles.library} aria-label="已保存角色">{characters.length?<div className={styles.cards}>{characters.map(c=><article key={c.id} className={styles.card}><CharacterPortrait character={c}/><div className={styles.cardBody}><h2>{c.name}</h2><p>{c.personality}</p><small>{c.appearance||'外貌由文字与故事共同定义'}</small><div><button className="text-button" disabled={busy} onClick={()=>begin(c)}><Pencil size={14}/>编辑</button><button className="secondary" disabled={busy} onClick={()=>{if(!dirty||confirm('放弃当前未保存的角色修改并开始创作？'))onUse(c);}}>用 TA 创作<ArrowUpRight size={14}/></button></div></div></article>)}</div>:<div className="empty"><h3>先认识一个人</h3><p>姓名与性格足以开始；外貌、语气与参考图可以慢慢补充。</p>{!draft&&<button className="secondary" onClick={()=>begin()}>创建第一个角色</button>}</div>}</section>
 {draft&&<form className={styles.form} onSubmit={e=>{e.preventDefault();if(busy)return;const next={...draft,name:draft.name.trim(),personality:draft.personality.trim()};if(!next.name||!next.personality){setMessage('请填写姓名与性格背景。');return;}if(onSave(next)){setDraft(next);setSaved(JSON.stringify(next));setMessage('已保存到本机。已有剧本中的角色保持原样。');}}}>
 <header><div><small>{characters.some(c=>c.id===draft.id)?'编辑角色模板':'新的相遇'}</small><h2>{draft.name||'定义 TA 的模样'}</h2></div><button type="button" className="text-button" disabled={busy} onClick={()=>{if(!dirty||confirm('放弃当前未保存的角色修改？'))setDraft(null);}}>收起</button></header>
 <label>角色姓名 <span>*</span><input required maxLength={60} value={draft.name} onChange={e=>field('name',e.target.value)} placeholder="TA 叫什么？"/></label>
 <label>性格与背景 <span>*</span><textarea required rows={4} value={draft.personality} onChange={e=>field('personality',e.target.value)} placeholder="TA 是怎样的人，有什么经历与愿望？"/></label>
 <label>外貌与穿着<textarea rows={2} value={draft.appearance??''} onChange={e=>field('appearance',e.target.value)} placeholder="可留空，或描述你希望保持的外观特征"/></label>
 <label>表达习惯<textarea rows={2} value={draft.speakingStyle??''} onChange={e=>field('speakingStyle',e.target.value)} placeholder="说话的节奏、语气、惯用表达"/></label>
 <label>相处边界<textarea rows={2} value={draft.boundaries??''} onChange={e=>field('boundaries',e.target.value)} placeholder="希望保持的距离与互动原则"/></label>
 <ImageAssetPicker role="character" assetId={draft.imageAssetId} onChange={id=>setDraft(prev=>prev?{...prev,imageAssetId:id}:prev)} onBusyChange={setBusy}/>
 <p className={styles.hint}>模板复制进剧本后独立编辑，不会联动修改已有剧本或游玩快照。图片只保存在当前浏览器。</p>
 <button type="submit" className="primary" disabled={busy}><Check size={16}/>{busy?'图片处理中…':'保存角色模板'}</button>{message&&<p role="status" className={styles.hint}>{message}</p>}
 </form>}
 </div></>;
}
