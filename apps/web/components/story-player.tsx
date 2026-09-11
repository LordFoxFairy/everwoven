'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Send,History,X} from 'lucide-react';
import type {Save} from '../../../packages/domain/src/story';
import {appendTurn} from '../../../packages/domain/src/story';
import {storyArtwork} from '../lib/presentation/story-art';
import {StoryJournal} from './story-journal';
import {recordDemoIntent} from '../mocks/intent';
import styles from './story-player.module.css';
import {ConfiguredLiveSession} from './configured-live-session';
export function Player({save,onChange,onExit}:{save:Save;onChange:(s:Save)=>boolean;onExit:()=>void}){
 const [input,setInput]=useState(''),[express,setExpress]=useState(false),[history,setHistory]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false),[hint,setHint]=useState(true),[live,setLive]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setHint(false),6500);return()=>clearTimeout(timer);},[]);
 useEffect(()=>{const handle=(event:KeyboardEvent)=>{if(event.key!=='Escape'||event.defaultPrevented||busy||history)return;if(live)return;if(express){setExpress(false);requestAnimationFrame(()=>entry.current?.focus());}else setMenu(value=>!value);};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[express,busy,history,live]);
 // A copied demo art ID must not silently impersonate a renamed custom character.
 const artwork=storyArtwork(save.story.artId==='linzhou'&&save.story.character.trim()!=='林舟'?{...save.story,artId:undefined}:save.story);
 const entry=useRef<HTMLButtonElement>(null),field=useRef<HTMLTextAreaElement>(null),lock=useRef(false);
 useEffect(()=>{if(express)field.current?.focus();},[express]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(input.trim())e.preventDefault();};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[input]);
 function close(){setExpress(false);requestAnimationFrame(()=>entry.current?.focus());}
 async function send(value:string){if(!value.trim()||lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const next=appendTurn(save,value);
  if(!onChange(next))throw Error('内容未保存，请检查本地存储。草稿已保留。');
  // Historical frontend demo: never a registered supplier/model implementation.
  await recordDemoIntent({inputId:next.turns[next.turns.length-1].id,text:value});
  setInput('');close();setNotice('已记录你的表达 · 尚未接入视频生成');
 }catch(e){setInput(value);setExpress(true);setError(e instanceof Error?e.message:'提交失败，草稿已保留');}finally{lock.current=false;setBusy(false);}}
 if(live)return <ConfiguredLiveSession story={save.story} onExit={()=>{setLive(false);setMenu(false);}}/>;
 return <main className={styles.player}>
  <section className={styles.stage} aria-label="视频现场预览">
   <button ref={entry} className={styles.scene} aria-label="表达你的想法，按 Escape 打开系统菜单" onClick={()=>{setExpress(true);setMenu(false);setHint(false);}} disabled={busy}>
    <span className={styles.art} style={{backgroundImage:`url(${artwork})`}}/>
   </button>
   <span className={styles.reference}>交互原型 · 静态参考画面</span>
   {hint&&!express&&!menu&&<p className={styles.hint}>点击画面或按 Tab、Enter 表达 · Esc 打开菜单</p>}
   <div className={styles.menuAccess}><button aria-label="打开系统菜单" aria-expanded={menu} onClick={()=>setMenu(!menu)}>···</button></div>
   {menu&&<aside className={styles.menu} aria-label="系统菜单">
    <div className={styles.composeHead}><h1>{save.story.title}</h1><button aria-label="关闭系统菜单" onClick={()=>{setMenu(false);entry.current?.focus();}}><X size={18}/></button></div>
    <p>与 {save.story.character}</p>
    <button onClick={()=>{setLive(true);setMenu(false);}}>进入实时生成</button>
    <button onClick={()=>{setHistory(true);setMenu(false);}}><History size={18}/>查看记录</button>
    <button disabled={busy} onClick={()=>{if(!input.trim()||confirm('还有未发送的草稿，确定退出吗？'))onExit();}}><ArrowLeft size={18}/>返回故事</button>
    <small>视频生成尚未接入。表达仅保存至本地，不触发生成或计费。</small>
   </aside>}
   <div className={styles.feedback} role="status" aria-live="polite">{notice}</div>
   <div className={styles.interaction}>
    {express?<form className={styles.composer} onSubmit={e=>{e.preventDefault();void send(input);}}><div className={styles.composeHead}><label htmlFor="live-expression">把你的想法带进这一刻</label><button type="button" onClick={close} disabled={busy} aria-label="收起并保留草稿"><X size={18}/></button></div><textarea id="live-expression" ref={field} value={input} disabled={busy} onChange={e=>setInput(e.target.value)} placeholder="说些什么，或描述你想做的事…" rows={2} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();close();}if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void send(input);}}}/><footer><span>仅记录，不触发生成 · ⌘ / Ctrl + Enter</span><button disabled={busy||!input.trim()}>{busy?'正在记录':'记录表达'}<Send size={15}/></button></footer></form>:null}
    {error&&<p className={styles.error} role="alert">{error}</p>}
   </div>
  </section>
  {history&&<StoryJournal save={save} onChange={onChange} onClose={()=>setHistory(false)}/>}
 </main>
}
