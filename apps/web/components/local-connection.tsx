'use client';
import {useEffect,useId,useState} from 'react';
import {useAuthoringSession} from '../lib/authoring/session-context';
import {Button} from './ui/button';
import styles from './local-connection.module.css';

/** Connection controls only: never conditionally mount/unmount an editor here. */
export function LocalConnection({disabled=false}:{disabled?:boolean}){
 const {state,connect}=useAuthoringSession(),[code,setCode]=useState(''),id=useId();
 useEffect(()=>{if(state.status==='connected')setCode('');},[state.status]);
 if(state.status==='demo')return null;
 if(state.status==='unconfigured')return <aside className={styles.panel}><strong>本机服务尚未启用</strong><p>请使用项目的本地启动入口启用 SQLite 服务。当前页面不会把正式内容改存到浏览器。</p></aside>;
 if(state.status==='connected')return <div className={styles.connected} role="status"><span aria-hidden="true"/>已连接本机<small>SQLite · 仅保存在这台设备</small></div>;
 return <aside className={styles.panel} aria-label="本机连接">
  <strong>{state.status==='checking'?'正在确认本机连接…':'连接你的创作空间'}</strong>
  <p>输入本地启动终端提供的一次性连接码。连接后继续当前编辑，内容无需重新填写。</p>
  <form onSubmit={event=>{event.preventDefault();if(!state.busy&&!disabled&&code.trim())void connect(code.trim());}}>
   <label htmlFor={id}>本机连接码</label>
   <div className={styles.row}><input id={id} type="password" autoComplete="off" spellCheck={false} value={code} disabled={state.busy||disabled} onChange={e=>setCode(e.target.value)}/><Button type="submit" disabled={state.busy||disabled||!code.trim()}>{state.busy?'连接中…':'连接本机'}</Button></div>
  </form>
  {state.error&&<p role="alert">{state.error}</p>}
 </aside>;
}
