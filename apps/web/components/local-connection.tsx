'use client';
import {useAuthoringSession} from '../lib/authoring/session-context';
import {Button} from './ui/button';
import styles from './local-connection.module.css';

/** Connection controls only: never conditionally mount/unmount an editor here. */
export function LocalConnection({disabled=false}:{disabled?:boolean}){
 const {state,connect}=useAuthoringSession();
 if(state.status==='demo')return null;
 if(state.status==='unconfigured')return <aside className={styles.panel}><strong>本机服务尚未启用</strong><p>请使用项目的本地启动入口启用 SQLite 服务。当前页面不会把正式内容改存到浏览器。</p></aside>;
 if(state.status==='connected')return <div className={styles.connected} role="status"><span aria-hidden="true"/>已连接本机<small>SQLite · 仅保存在这台设备</small></div>;
 return <aside className={styles.panel} aria-label="本机连接">
  <strong>{state.status==='checking'?'正在连接本机…':'本机连接暂不可用'}</strong>
  <p>未保存的内容仍保留。连接恢复后，请显式确认尚未确认的保存。</p>
  <Button type="button" disabled={state.busy||disabled} onClick={()=>void connect()}>{state.busy?'正在连接…':'重新连接'}</Button>
  {state.error&&<p role="alert">{state.error}</p>}
 </aside>;
}
