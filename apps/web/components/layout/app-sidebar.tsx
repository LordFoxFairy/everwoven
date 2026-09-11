'use client';
import {BookOpen, Compass, History, House, Plus, Users} from 'lucide-react';
import styles from './app-shell.module.css';

export const navigation = [
  {id:'home', label:'我的世界', icon:House},
  {id:'explore', label:'剧本广场', icon:Compass},
  {id:'library', label:'我的剧本', icon:BookOpen},
  {id:'characters', label:'角色库', icon:Users},
  {id:'saves', label:'我的游玩', icon:History},
] as const;
export type WorkspaceView = typeof navigation[number]['id'];
type Props = {view: WorkspaceView; draftCount: number; onNavigate: (view: WorkspaceView) => void; onCreate: () => void};

export function AppSidebar({view, draftCount, onNavigate, onCreate}: Props) {
  return <aside className={styles.sidebar} aria-label="应用导航">
    <a href="#main" className={`brand ${styles.brand}`} aria-label="未完 · 返回我的世界" onClick={event => {event.preventDefault();onNavigate('home');}}>
      <span className="brand-mark">w.</span><span>未完<small>STORIES, STILL BECOMING</small></span>
    </a>
    <div className={styles.navigation} data-sidebar-scroll="">
      <div className="nav-group-label">你的故事，从这里开始</div>
      <nav aria-label="主要导航">{navigation.map(({id, label, icon:Icon}) =>
        <button key={id} aria-current={view===id?'page':undefined} aria-label={label} title={label}
          className={view===id?'nav-item active':'nav-item'} onClick={() => onNavigate(id)}>
          <Icon size={19}/>{label}{id==='library' && draftCount>0 && <small>{draftCount}</small>}
        </button>)}</nav>
      <button className="create-side" onClick={onCreate}><Plus size={17}/>创作一个剧本</button>
    </div>
    <div className={`sidebar-bottom ${styles.footer}`}>
      <div className="draft-note"><span className="small-star">✧</span><p>故事没有标准答案。<br/><strong>下一幕，听你的。</strong></p></div>
      <div className="profile"><span className="avatar">你</span><div>故事创作者<small>本地原型 · 非云同步</small></div></div>
    </div>
  </aside>;
}
