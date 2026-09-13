'use client';
import {useEffect} from 'react';
import {ArrowUpRight, RefreshCw, BookOpen, Film} from 'lucide-react';
import {Button} from './ui/button';
import {budgetToText, type OpeningController, type OpeningState} from '../lib/experience/opening-controller';
import styles from './experience-library.module.css';
export function ExperienceLibrary({controller, state, datasetId, connectionEpoch, onOpen, onCreate}: {
  controller: OpeningController; state: OpeningState; datasetId: string | null; connectionEpoch: unknown;
  onOpen: (id: string, trigger: HTMLButtonElement) => void; onCreate: () => void;
}) {
  useEffect(() => {if (state.connected) void controller.loadExperiences();}, [controller, state.connected, datasetId, connectionEpoch]);
  return <section aria-labelledby="experience-library-title">
    <div className="page-heading"><div><p className="eyebrow">YOUR UNFOLDING STORIES</p><h1 id="experience-library-title">我的游玩</h1><p>每次确认的开局，都为你留在这台设备上。</p></div>
      <Button variant="outline" disabled={!state.connected || state.listLoading} onClick={() => void controller.loadExperiences()}><RefreshCw size={15}/>刷新旅程</Button></div>
    <p className={styles.note}>当前可查看已固定的故事准备。视频生成和正式续玩尚未接通，不会用演示片段替代。</p>
    {state.listError && <p role="alert" className={styles.error}>{state.listError}</p>}
    {state.listLoading && <p role="status" className={styles.note}>正在读取本机旅程…</p>}
    {state.reading && <p role="status" className={styles.note}>正在读取封存的开局…</p>}
    {!state.connected && <p role="status">连接本机后可读取已保存的旅程。</p>}
    <div className={styles.grid}>{state.items.map(item => <article className={styles.card} key={item.id}>
      <div className={styles.top}><Film size={20}/><span>{item.status === 'preparing' ? '故事准备' : '已离开初始准备'}</span></div>
      <h2>{item.title}</h2><p className={styles.meta}>来源修订 {item.sourceRevision} · {item.modelId}</p>
      <dl><div><dt>固定地区</dt><dd>{item.region === 'cn' ? '中国区' : item.region === 'international' ? '国际区' : item.region}</dd></div>
        <div><dt>预算上限</dt><dd>{budgetToText(item.budget)} {item.budget.currency}</dd></div></dl>
      <footer><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time><Button variant="outline" disabled={!state.connected || state.busy || state.reading || item.status !== 'preparing'}
        aria-label={`查看准备 ${item.title}`} onClick={event => onOpen(item.id, event.currentTarget)}>查看准备<ArrowUpRight size={16}/></Button></footer>
    </article>)}</div>
    {state.connected && state.listReady && !state.listLoading && !state.listError && state.items.length === 0 && <div className="empty"><BookOpen/><h3>你的第一段旅程，还没开始</h3><p>先写下世界与角色，再为这次开局确认配置。</p><Button onClick={onCreate}>创建剧本</Button></div>}
    {state.nextCursor && <Button variant="outline" disabled={!state.connected || state.listLoading} onClick={() => void controller.loadExperiences(true)}>加载更多旅程</Button>}
  </section>;
}
