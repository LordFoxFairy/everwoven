'use client';
import {createEntityId} from '../../../packages/domain/src/id';

import {SessionOpening} from './session-opening';
import {StoryAssetStatus} from './story-asset-status';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,ArrowRight,Volume2,VolumeX,MoreHorizontal,X,LoaderCircle} from 'lucide-react';
import type {Story} from '../../../packages/domain/src/story';
import type {LiveVideoProvider} from '../lib/video/types';
import {SessionController,buildOpeningPrompt} from '../lib/video/session-controller';
import styles from './live-session.module.css';
import {createAppClient} from '../trpc/client';

export function LiveSession({story,provider,onExit}:{story:Story;provider:LiveVideoProvider;onExit:()=>void}){
 const [controller]=useState(()=>new SessionController(provider));
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const [available,setAvailable]=useState<boolean|null>(null);
 const [input,setInput]=useState(''),[express,setExpress]=useState(false),[menu,setMenu]=useState(false);
 const [muted,setMuted]=useState(true),[sound,setSound]=useState(false),[playBlocked,setPlayBlocked]=useState(false);
 const [showHint,setShowHint]=useState(true);
 const [localError,setLocalError]=useState(''),[leaveConfirm,setLeaveConfirm]=useState(false);
 const [aspectRatio,setAspectRatio]=useState<'9:16'|'16:9'>('16:9');
 const video=useRef<HTMLVideoElement>(null),entry=useRef<HTMLButtonElement>(null),field=useRef<HTMLTextAreaElement>(null);
 const menuButton=useRef<HTMLButtonElement>(null),handledReject=useRef(''),mounted=useRef(false);
 const pendingOpen=state.phase==='connecting',terminal=state.phase==='ended'||state.phase==='failed';
 const latest=state.intents.at(-1);
 const busy=state.phase==='ending';
 const canExpress=state.ready&&state.media!=='waiting'&&!terminal&&!busy;

 async function checkAvailability(signal?:AbortSignal){
  setAvailable(null);
  try{const data=await createAppClient().video.configuration.query(undefined,{signal});if(!signal?.aborted)setAvailable(data.available===true&&data.selection?.providerId===provider.providerId&&data.selection?.modelId===provider.modelId);}
  catch{if(!signal?.aborted)setAvailable(false);}
 }
 useEffect(()=>{
  mounted.current=true;const abort=new AbortController();void checkAvailability(abort.signal);
  return()=>{mounted.current=false;abort.abort();
   // React's development effect replay is not a real departure.
   queueMicrotask(()=>{if(!mounted.current)void controller.close().catch(()=>{});});
  };
 },[controller]);
 useEffect(()=>{
  const element=video.current;if(!element||!state.stream)return;
  element.srcObject=state.stream;void element.play().catch(()=>setPlayBlocked(true));
  return()=>{element.srcObject=null;};
 },[state.stream]);
 useEffect(()=>{if(express)field.current?.focus();},[express]);
 useEffect(()=>{if(state.media!=='playing')return;const timer=setTimeout(()=>setShowHint(false),6500);return()=>clearTimeout(timer);},[state.media]);
 useEffect(()=>{
  if(latest?.state==='rejected'&&handledReject.current!==latest.id){
   handledReject.current=latest.id;setInput(current=>current||latest.text);setExpress(true);setLocalError('这次行动未被接受。原文保留在下方，可修改后重试。');
  }
 },[latest]);
 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.isComposing||busy||state.phase==='prepare')return;
   if(event.key==='Escape'){
    event.preventDefault();
    if(leaveConfirm){setLeaveConfirm(false);return;}
    if(express){setExpress(false);entry.current?.focus();return;}
    setMenu(value=>!value);return;
   }
   const target=event.target as HTMLElement;
   if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!target.closest('input,textarea,button,a,select,[contenteditable="true"]')&&canExpress&&!menu&&!leaveConfirm){event.preventDefault();setExpress(true);}
  };
  const beforeUnload=(event:BeforeUnloadEvent)=>{if((state.phase!=='prepare'&&state.phase!=='ended')||input.trim())event.preventDefault();};
  window.addEventListener('keydown',handler);window.addEventListener('beforeunload',beforeUnload);
  return()=>{window.removeEventListener('keydown',handler);window.removeEventListener('beforeunload',beforeUnload);};
 },[state.phase,canExpress,busy,express,menu,leaveConfirm,input]);

 function start(){
  if(!available||state.phase!=='prepare')return;
  setMuted(!sound);setLocalError('');
  void controller.start({prompt:buildOpeningPrompt(story),resolution:'480p',aspectRatio});
 }
 async function leave(){
  if(busy)return;
  setLeaveConfirm(false);
  try{await controller.close();onExit();}catch{/* The controller preserves an actionable error. */}
 }
 function requestLeave(){if(input.trim()||!terminal&&state.phase!=='prepare')setLeaveConfirm(true);else void leave();}
 function send(){
  try{controller.send(createEntityId(),input);setInput('');setExpress(false);setLocalError('');entry.current?.focus();}
  catch(error){setLocalError(error instanceof Error?error.message:'发送失败，草稿已保留。');}
 }
 function restorePlayback(){void video.current?.play().then(()=>setPlayBlocked(false)).catch(()=>setLocalError('播放尚未恢复，请检查浏览器播放权限。'));}
 const feedback=latest?({sent:'行动已发出，等待接收',accepted:'行动已接收，正在影响后续生成',generated:'相关片段已生成；画面响应以实际播放为准',rejected:'行动未被接受'})[latest.state]:'';

 if(state.phase==='prepare')return <main className={styles.prepare}>
  <button className={styles.back} onClick={onExit}><ArrowLeft size={17}/>返回剧本</button>
  <section className={styles.preparation} aria-labelledby="prepare-title">
   <SessionOpening story={story}/>
   <div className={styles.setup}><h2>准备好，就开始</h2><p>开始后，人物与环境会先行动。你可以自然观看，也可以随时介入。</p><fieldset><legend>画面构图</legend><div className={styles.ratios}>{(['16:9','9:16'] as const).map(r=><label key={r}><input type="radio" name="aspect" value={r} checked={aspectRatio===r} onChange={()=>setAspectRatio(r)}/>{r==='16:9'?'桌面宽屏 · 16:9（默认）':'竖向构图 · 9:16（可选）'}</label>)}</div><p className={styles.frameNote}>画面随窗口等比适配。调整窗口不会重新生成，也不会拉伸或裁切人物。</p></fieldset><label className={styles.sound}><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/>播放人物声音与环境声<span>不启用麦克风</span></label>
   <StoryAssetStatus story={story}/><details className={styles.technical}><summary>本次生成设置</summary><p>{provider.label} · 480p<br/>当前使用文字设定生成，角色参考图片尚未传给模型。</p></details>
   <div className={styles.cost}><strong>实时生成会产生 API 费用</strong><p>每次会话至少按 60 秒计费。当前客户端连接约两分钟后关闭，不自动重连。离开前请结束生成；静音不会停止计费。</p><a href="https://fal.ai/h3-max-director" target="_blank" rel="noreferrer">核对供应商当前价格 ↗</a></div>
   {available===false&&<div className={styles.unavailable} role="status"><strong>实时引擎还未就绪</strong><p>请在服务端配置密钥并启用本地接入。准备好后再开始，不会用静态图片代替游戏。</p><button onClick={()=>void checkAvailability()}>重新检查</button></div>}
   <button className={styles.start} disabled={!available} onClick={start}>{available===null?<><LoaderCircle size={17} className={styles.spin}/>检查引擎…</>:<>开始游玩<ArrowRight size={18}/></>}</button><small>点击即确认上述计费方式。开场自动生成，无需先输入一句话。现阶段记录不保证恢复同一视频现场。</small></div>
  </section>
 </main>;
 return <main className={styles.live} aria-label="实时游玩现场">
  <header className={styles.stageHeader}><div className={styles.sceneHeading}>{state.media==='playing'&&!terminal&&!busy&&<span className={styles.liveDot} aria-label="正在播放"/>}{story.title}</div>
  <button ref={menuButton} className={styles.menuButton} aria-label="现场菜单" aria-expanded={menu} onClick={()=>setMenu(!menu)}><MoreHorizontal size={22}/></button>
  </header>
  <section className={styles.videoStage} aria-label="视频舞台">
  <video ref={video} autoPlay playsInline muted={muted} onPlaying={()=>{controller.markPlaying();setPlayBlocked(false);}} onWaiting={controller.markBuffering} onStalled={controller.markBuffering}/>
  {(pendingOpen||state.media==='waiting'&&!terminal)&&<div className={styles.waiting} role="status"><LoaderCircle className={styles.spin} size={22}/><h2>{pendingOpen?'正在进入故事':'世界正在展开'}</h2><p>{pendingOpen?'建立实时连接，不会自动重复启动':'等待第一段画面，无需先发送消息'}</p><button disabled={busy} onClick={requestLeave}>取消进入</button></div>}
  {state.media==='buffering'&&!terminal&&<div className={styles.buffering} role="status">画面正在缓冲，现场尚未停止生成</div>}
  {playBlocked&&!terminal&&<button className={styles.playRestore} onClick={restorePlayback}>点击开始播放</button>}
  {menu&&<aside className={styles.menu} aria-label="现场设置"><div><span>现场设置</span><button aria-label="关闭菜单" onClick={()=>{setMenu(false);menuButton.current?.focus();}}><X size={18}/></button></div><button onClick={()=>{setMuted(!muted);restorePlayback();}}>{muted?<Volume2 size={17}/>:<VolumeX size={17}/>} {muted?'开启声音':'静音'}</button><button disabled={busy} onClick={requestLeave}>结束本次生成</button><small>关闭浏览器不等于确认停止计费。请使用结束操作。</small></aside>}
  {terminal&&<div className={styles.waiting} role="status"><h2>{state.phase==='failed'?'现场暂时中断':'本次连接已结束'}</h2><p>{state.error||'客户端连接已关闭，计费结束情况以服务端记录为准。'}</p><button disabled={busy} onClick={requestLeave}>返回剧本</button></div>}
  {busy&&<div className={styles.waiting} role="status"><LoaderCircle size={22} className={styles.spin}/><h2>正在结束连接</h2><p>正在释放本次会话，请稍等。</p></div>}
  </section>
  {!terminal&&!busy&&<div className={styles.inputZone}>
   {showHint&&state.media==='playing'&&!express&&!latest&&<p className={styles.receipt}>不必等待选项，随时用自己的方式介入</p>}
   {feedback&&<p className={styles.receipt} role="status">{feedback}</p>}
   {express?<form onSubmit={e=>{e.preventDefault();send();}}><div className={styles.inputHead}><label htmlFor="live-direction">说些什么，或做些什么</label><button type="button" aria-label="收起并保留草稿" onClick={()=>{setExpress(false);entry.current?.focus();}}><X size={18}/></button></div><textarea id="live-direction" ref={field} value={input} maxLength={50000} onChange={e=>setInput(e.target.value)} rows={2} placeholder="用你自己的方式，让故事继续…" onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/><footer><span>影响接下来的生成 · ⌘ / Ctrl + Enter</span><button disabled={!input.trim()||!state.ready}>带入故事<ArrowRight size={16}/></button></footer></form>:canExpress&&<button ref={entry} className={styles.entry} onClick={()=>setExpress(true)} aria-label="自由表达">{input?'继续未发送的表达':'自由表达'}<span>Enter</span></button>}
   {localError&&<p className={styles.error} role="alert">{localError}</p>}
  </div>}
  {leaveConfirm&&<ExitDialog onCancel={()=>setLeaveConfirm(false)}><h2 id="leave-title">结束这一刻？</h2><p>{input.trim()?'还有未发送的表达，退出会舍弃这份草稿。':'这会发送停止指令并关闭连接，不会自动开启下一次生成。'}</p><button autoFocus onClick={()=>setLeaveConfirm(false)}>留在现场</button><button onClick={()=>void leave()}>结束并返回</button></ExitDialog>}
 </main>;
}

function ExitDialog({children,onCancel}:{children:React.ReactNode;onCancel:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=ref.current;node?.showModal();return()=>node?.close();},[]);
 return <dialog ref={ref} className={styles.confirmDialog} aria-labelledby="leave-title" onCancel={event=>{event.preventDefault();onCancel();}}>{children}</dialog>;
}
