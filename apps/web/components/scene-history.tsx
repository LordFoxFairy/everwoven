'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {History,ArrowLeft,GitBranch,X} from 'lucide-react';
import {v7} from 'uuid';
import type {HistoryPage,SavedSceneDetail,ForkCommand} from 'runtime/contracts/history';
import type {PlayController,PlayState} from '../lib/experience/play-controller';
import {PlaybackClientError,createGenerationClient} from '../lib/experience/playback-client';
import {writePlayRoute} from '../lib/experience/play-route';
import styles from './scene-history.module.css';

type Props={controller:PlayController;state:PlayState;container:HTMLElement|null;onPreview:(scene:SavedSceneDetail|null)=>void;onOpenChange:(open:boolean)=>void};
/** A single floating history panel. The existing stage remains the only video. */
export function SceneHistory({controller,state,container,onPreview,onOpenChange}:Props){
 const [client]=useState(()=>createGenerationClient().history),[open,setOpen]=useState(false),[page,setPage]=useState<HistoryPage|null>(null),[selected,setSelected]=useState<SavedSceneDetail|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[recoverId,setRecoverId]=useState<string|null>(null);
 const pending=useRef<ForkCommand|null>(null),sequence=useRef(0),mounted=useRef(true);
 const scope=()=>({protocolVersion:1 as const,datasetId:state.datasetId!,experienceId:state.experienceId!});
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
 useEffect(()=>{const id=new URLSearchParams(window.location.hash.slice(1)).get('fork');if(id&&/^[0-9a-f-]{36}$/.test(id)){setRecoverId(id);setOpen(true);onOpenChange(true);}},[]);
 function show(value:boolean){if(!value&&(busy||recoverId))return;setOpen(value);onOpenChange(value);if(!value){sequence.current++;setSelected(null);setConfirm(false);onPreview(null);}else void list();}
 async function list(beforeId?:string){const ticket=++sequence.current;setBusy(true);setError('');try{const result=await client.list({...scope(),...(beforeId?{beforeId}:{})});if(mounted.current&&ticket===sequence.current)setPage(result);}catch{if(ticket===sequence.current)setError('故事足迹暂未读到，请重试。');}finally{if(mounted.current&&ticket===sequence.current)setBusy(false);}}
 async function choose(id:string){const ticket=++sequence.current;setBusy(true);setError('');try{const scene=await client.get({...scope(),savepointId:id});if(mounted.current&&ticket===sequence.current){setSelected(scene);setConfirm(false);onPreview(scene);}}catch{if(ticket===sequence.current)setError('这一幕暂时不可读，原路线仍保留。');}finally{if(mounted.current&&ticket===sequence.current)setBusy(false);}}
 async function enter(experienceId:string){pending.current=null;setRecoverId(null);writePlayRoute({datasetId:state.datasetId!,experienceId});onPreview(null);onOpenChange(false);setOpen(false);await controller.open(experienceId);}
 async function recover(){if(!recoverId||busy)return;setBusy(true);setError('');try{
  const result=await client.recover({...scope(),commandId:recoverId});
  if(result){await enter(result.data.experienceId);return;}
  if(pending.current){const created=await client.fork(pending.current);await enter(created.data.experienceId);return;}
  // A read miss is not proof that an earlier in-flight request will never commit.
  setError('原请求还没有确认结果。请稍后再次核对，或从“我的游玩”查看已创建的路线。');
 }catch{setError('还未核对到可靠结果，请继续核对原分支。');}finally{if(mounted.current)setBusy(false);}}
 async function fork(){if(!selected||busy||state.busy||state.acceptUnknown||state.quote||state.draftConflict)return;setBusy(true);setError('');
  try{
   if(controller.draftDirty()&&!await controller.saveDraft()){setError('请先保存当前回应，再另开路线。');return;}
   const command:ForkCommand={...scope(),commandId:v7(),savepointId:selected.savepoint.id,expectedSnapshotHash:selected.savepoint.snapshotHash,branchBudgetLimitMicros:selected.budget.limitMicros,currency:selected.budget.currency};
   // Only command identity is stored in navigation. Reload performs a read-only recovery.
   const url=new URL(window.location.href);const query=new URLSearchParams(url.hash.slice(1));query.set('fork',command.commandId);url.hash=query.toString();window.history.replaceState(null,'',url);
   pending.current=command;setRecoverId(command.commandId);
   const result=await client.fork(command);await enter(result.data.experienceId);
  }catch(error){if(error instanceof PlaybackClientError&&error.outcome==='rejected'){pending.current=null;setRecoverId(null);writePlayRoute({datasetId:state.datasetId!,experienceId:state.experienceId!});setError('这次未创建新路线。请重新读取足迹后再试。');}else setError('分支创建结果待核对，原故事和回应都保留。');}finally{if(mounted.current)setBusy(false);}
 }
 return <Dialog.Root open={open} onOpenChange={show}>
  <button aria-label="故事足迹" disabled={Boolean(state.busy)||Boolean(state.quote)||state.reading} onClick={()=>show(true)}><History size={17}/><span>足迹</span></button>
  <Dialog.Portal container={container}>
   <Dialog.Overlay className={styles.scrim}/>
   <Dialog.Content className={styles.panel} onEscapeKeyDown={e=>{e.stopPropagation();if(busy||recoverId)e.preventDefault();}} onPointerDownOutside={e=>{if(busy||recoverId)e.preventDefault();}}>
    <header><div><Dialog.Title>故事足迹</Dialog.Title><Dialog.Description>看过的每一幕，都留下另一种可能。</Dialog.Description></div><Dialog.Close disabled={busy||Boolean(recoverId)} aria-label="收起故事足迹"><X size={18}/></Dialog.Close></header>
    {recoverId?<section className={styles.detail}><h3>找回刚才的新路线</h3><p>只核对原来的创建请求，不提交视频生成。</p><button disabled={busy} onClick={()=>void recover()}>核对原分支</button>{error&&<><p>也可以返回原路线；若原请求稍后完成，新路线会保留在“我的游玩”。</p><button disabled={busy} onClick={()=>{pending.current=null;setRecoverId(null);writePlayRoute({datasetId:state.datasetId!,experienceId:state.experienceId!});setOpen(false);onOpenChange(false);onPreview(null);}}>返回原路线</button></>}</section>:selected?<section className={styles.detail}>
     <button disabled={busy} onClick={()=>{setSelected(null);setConfirm(false);onPreview(null);}}><ArrowLeft size={15}/>返回足迹</button>
     <small>{selected.savepoint.inherited?'共同经历':'已看过的一幕'} · 回看不改变当前进展</small><p>{selected.scene.summary}</p>
     {!confirm?<button className={styles.primary} disabled={busy||!selected.canFork} onClick={()=>setConfirm(true)}><GitBranch size={16}/>从这里另开路线</button>:<div className={styles.confirm}><h3>保留原路线，试试另一个选择</h3><p>从这一幕后继续。新路线与原故事共用总额度，创建不收费，生成前会再次确认费用。</p><button disabled={busy} onClick={()=>setConfirm(false)}>再想想</button><button className={styles.primary} disabled={busy} onClick={()=>void fork()}>创建新路线</button></div>}
     {!selected.canFork&&<p>原来源已归档或删除，可以继续回看当前路线已有的片段。</p>}
    </section>:<div className={styles.list}>
     {!page&&!busy&&<button onClick={()=>void list()}>读取足迹</button>}
     {page?.items.map((scene)=><button key={scene.id} disabled={busy} onClick={()=>void choose(scene.id)}><span className={styles.dot}/><div><small>{scene.inherited?'共同经历':'已看过'} · {new Date(scene.createdAt).toLocaleString()}</small><p>{scene.summary}</p></div><span>查看</span></button>)}
     {page?.items.length===0&&<p>看完第一幕后，足迹会保存在这里。</p>}
     {page?.nextBeforeId&&<button disabled={busy} onClick={()=>void list(page.nextBeforeId!)}>更早的足迹</button>}
    </div>}
    {busy&&<p role="status">正在确认…</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
   </Dialog.Content>
  </Dialog.Portal>
 </Dialog.Root>;
}
