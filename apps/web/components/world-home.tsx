'use client';
import {ArrowRight, ArrowUpRight, BookOpen, Compass, Film, Plus, CornerDownRight} from 'lucide-react';
import type {Library, RehearsalSave} from './storage';
import type {Story} from '../../../packages/domain/src/story';
import {recentlyOpened, rehearsalResumeCopy} from '../lib/presentation/rehearsal-resume';
import {SkyWelcome} from './sky-welcome';
import {StoryThumbnail, useStoryArtwork} from './story-assets';
import {useAppEnvironment} from '../lib/environment/context';
import styles from './world-home.module.css';

type Props = {
  library: Library; loadError?: string; onCreate: () => void; onExplore: () => void;
  onResume: (save: RehearsalSave) => void; onEdit: (story: Story) => void;
  onLibrary: () => void; onSaves: () => void;
};

function WorldImage({story}: {story: Story}) {
  const art = useStoryArtwork(story);
  return <div className={styles.art}>
    {art.url ? <img src={art.url} alt={`${story.title}的静态参考图`}/> : <div className={styles.artEmpty}><span aria-hidden="true">✧</span><p>{art.missing ? '本机图片缺失' : '把想象，留给你的世界'}</p></div>}
    <span className={styles.artLabel}>静态参考 · 非生成视频</span>
  </div>;
}

export function WorldHome({library, loadError, onCreate, onExplore, onResume, onEdit, onLibrary, onSaves}: Props) {
  const demo=useAppEnvironment()==='demo';
  if (loadError) return <section className={styles.unavailable} role="alert"><span className={styles.eyebrow}>YOUR STORIES STAY YOURS</span><h1>先保护好你的故事。</h1><p>{loadError}</p><small>这不代表你的故事为空。原数据未被重置，保存暂时停用。</small></section>;
  const save = recentlyOpened(library.saves);
  const featuredDraft = save ? undefined : library.drafts[0];
  const story = save?.story || featuredDraft;
  const resume = save ? rehearsalResumeCopy(save) : undefined;
  const drafts = library.drafts.filter(draft => draft.id !== featuredDraft?.id).slice(0, 3);
  return <div className={styles.home}>
    {story ? <section className={styles.returning} aria-labelledby="home-title">
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{save ? 'YOUR WORLD, TO BE CONTINUED' : 'A WORLD TAKING SHAPE'}</span>
        <p className={styles.prelude}>{save ? '故事还在，下一步留给你。' : '你想象的世界，正在成形。'}</p>
        <h1 id="home-title">{story.title || '尚未命名的世界'}</h1>
        <div className={styles.identity}><span>{story.character || '角色待定义'}</span><span>{story.genre || '自由题材'}</span></div>
        <div className={styles.checkpoint}><span className={styles.checkpointMark} aria-hidden="true"><CornerDownRight size={18}/></span><div><strong>{resume?.label || '从你自己的设定继续创作'}</strong><p>{resume?.description || '打磨角色、世界与开场，准备好后再进入演练。没有预先写好的结局。'}</p></div></div>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => save ? onResume(save) : onEdit(story)}>{resume?.action || '继续创作'}<ArrowUpRight size={18}/></button>
          <button className={styles.textButton} onClick={save ? onSaves : onLibrary}>{save ? '全部游玩记录' : '我的所有剧本'}<ArrowRight size={15}/></button>
        </div>
        <small className={styles.source}>{save ? `最近开启的演练 · ${save.turns.length} 条已记录回应` : '你的本地草稿'} · 仅此浏览器保存</small>
      </div>
      <WorldImage story={story}/>
    </section> : <SkyWelcome onCreate={onCreate} onExplore={onExplore}/>}

    <section className={styles.beneath} aria-label="你的创作入口">
      <div className={styles.studio}>
        <header><div><span className={styles.eyebrow}>MAKE IT YOURS</span><h2>{drafts.length ? (featuredDraft ? '其他创作中的世界' : '继续你的创作') : '从一个念头，到身临其境'}</h2></div>{drafts.length > 0 && <button className={styles.textButton} onClick={onLibrary}>查看全部<ArrowRight size={14}/></button>}</header>
        {drafts.length > 0 ? <div className={styles.drafts}>{drafts.map(draft => <button key={draft.id} className={styles.draft} onClick={() => onEdit(draft)}><StoryThumbnail story={draft}/><span><strong>{draft.title || '尚未命名的世界'}</strong><small>{draft.character || '角色待定义'} · 本地草稿</small></span><ArrowUpRight size={17}/></button>)}</div>
          : <ol className={styles.path}><li><span>01</span><div><strong>定义你的世界</strong><p>人物、关系、开场，都由你设定。</p></div></li><li><span>02</span><div><strong>进入故事现场</strong><p>{demo?'当前先用静态参考演练交互。':'保存开场设定，视频生成尚未接入。'}</p></div></li><li><span>03</span><div><strong>在回应中改变方向</strong><p>片段结束后，选一个方向或自己表达。</p></div></li></ol>}
      </div>
      <div className={styles.inspiration}>
        <span className={styles.eyebrow}><Compass size={14}/> ROOM FOR SOMETHING NEW</span>
        <h2>也可以，开启另一种可能。</h2>
        <p>不必延续同一种关系，也不必写同一个故事。</p>
        <button className={styles.newWorld} onClick={onCreate}><Plus size={17}/>创建另一个世界<ArrowUpRight size={16}/></button>
        {demo&&<button className={styles.textButton} onClick={onExplore}><BookOpen size={15}/>从示例找点灵感<ArrowRight size={14}/></button>}
      </div>
    </section>
    <p className={styles.footnote}><Film size={14}/>{demo?'当前为前端交互演练，不调用模型；真实视频生成另行接入。':'当前开放本地创作，真实视频生成尚未接通；不会用演练代替。'}</p>
  </div>;
}
