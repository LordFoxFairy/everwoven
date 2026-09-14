'use client';
import {useEffect, useRef, type ReactNode} from 'react';
import {AppSidebar, navigation, type WorkspaceView} from './app-sidebar';
import {useAppEnvironment} from '../../lib/environment/context';
import styles from './app-shell.module.css';

type Props = {view: WorkspaceView; draftCount: number; onNavigate: (view: WorkspaceView) => void; onCreate: () => void; children: ReactNode};

/** Owns viewport regions only. Data, routing guards and saving stay with Platform. */
export function AppShell({view, draftCount, onNavigate, onCreate, children}: Props) {
  const environment=useAppEnvironment();
  const content=useRef<HTMLElement>(null);
  useEffect(() => {if (content.current) content.current.scrollTop=0;}, [view]);
  return <div className={styles.shell}>
    <a className="skip" href="#main">跳到主要内容</a>
    <AppSidebar view={view} draftCount={draftCount} onNavigate={onNavigate} onCreate={onCreate}/>
    <div className={styles.workspace}>
      <header className={`topbar ${styles.header}`}><span>{navigation.find(item => item.id===view)?.label}</span>
        <div><span className="mode-badge"><span className="demo-dot"/>{environment==='demo'?'演示环境':environment==='dev'?'开发环境':'生产环境'}</span><span className="topbar-note">{environment==='demo'?'仅本机 · 不调用模型':'本机保存 · 由你决定下一幕'}</span></div>
      </header>
      <main id="main" ref={content} tabIndex={-1} className={styles.content}>{children}</main>
    </div>
  </div>;
}
