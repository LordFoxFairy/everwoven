'use client';
import {ArrowUpRight, ArrowRight, Plus, Sparkles} from 'lucide-react';
import {useAppEnvironment} from '../lib/environment/context';
import styles from './sky-welcome.module.css';

export function SkyWelcome({onCreate, onExplore}: {onCreate: () => void; onExplore: () => void}) {
  const demo=useAppEnvironment()==='demo';
  return <section className={styles.welcome} aria-labelledby="welcome-title">
    <div className={styles.sky} aria-hidden="true"><div className={styles.cloud}/><div className={styles.horizon}/></div>
    <div className={styles.copy}>
      <span className={styles.eyebrow}><Sparkles size={14}/> A LITTLE WONDER, A WORLD OF YOUR OWN</span>
      <h1 id="welcome-title">让想象发生。<br/><span>让故事，属于你。</span></h1>
      <p>一个世界，一位想遇见的人。<br/>从你的设定开始，把下一幕留给自己的选择。</p>
      <div className={styles.actions}><button className={styles.create} onClick={onCreate}><Plus size={17}/>创建我的世界<ArrowUpRight size={17}/></button>{demo&&<button className={styles.explore} onClick={onExplore}>探索示例开端<ArrowRight size={16}/></button>}</div>
      <div className={styles.note}><span/>{demo?'前端演练 · 设定保存在本浏览器 · 不调用模型':'本地创作 · 设定保存在本浏览器 · 视频生成尚未接入'}</div>
    </div>
    <div className={styles.visual} aria-hidden="true">
      <div className={styles.orbit}/>
      <div className={styles.window}><div className={styles.windowBar}><span/><span/><span/><small>A STORY, STILL BECOMING</small></div><div className={styles.windowSky}><div className={styles.windowCloud}/><span className={styles.star}>✧</span><div className={styles.windowCaption}><small>没有写好的结局</small><strong>只差你的下一句。</strong></div></div></div>
      <span className={styles.floatingNote}><Sparkles size={13}/>世界，由你定义</span>
      <span className={styles.smallNote}>to be continued <span>↗</span></span>
    </div>
  </section>;
}
