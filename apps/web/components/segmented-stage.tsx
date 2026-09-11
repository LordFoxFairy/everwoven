'use client';
import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Maximize, Minimize2, X} from 'lucide-react';
import styles from './segmented-stage.module.css';
import {StageConfirmation} from './stage-confirmation';

export type SegmentedStageProps = {
  title: string; context: string; phase: 'generating' | 'watching' | 'awaiting' | 'failed';
  media: {kind: 'reference' | 'video'; url: string}; simulated: boolean;
  choices: {id: string; title: string; text: string}[];
  onEnded: () => void; onRespond: (text: string) => boolean; onExit: () => void;
  onRetry: () => void; onFail?: () => void;
  initialResponseDraft?: string; onDraftChange?: (text: string) => void;
  storageError?: string; onRetrySave?: () => void;
};

/** Presentation shared by rehearsal and future validated segment results. */
export function SegmentedStage(props: SegmentedStageProps) {
  const {title, context, phase, media, simulated, choices, onEnded, onRespond, onExit, onRetry, onFail} = props;
  const [collapsed, setCollapsed] = useState(false), [express, setExpress] = useState(Boolean(props.initialResponseDraft));
  const [text, setText] = useState(props.initialResponseDraft || ''), [error, setError] = useState(''), [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [confirmation, setConfirmation] = useState<{type: 'leave'} | {type: 'replace' | 'respond'; text: string} | null>(null);
  const portal = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null), field = useRef<HTMLTextAreaElement>(null), reopen = useRef<HTMLButtonElement>(null);
  useEffect(() => {if (phase === 'awaiting') {setCollapsed(false);setExpress(Boolean(props.initialResponseDraft));} else if (phase === 'generating') {setText('');setError('');}}, [phase]);
  useEffect(() => {if (express) field.current?.focus();}, [express]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {if (text.trim() || props.storageError) event.preventDefault();};
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [text, props.storageError]);
  function changeDraft(value: string) {setText(value);props.onDraftChange?.(value);}
  function respond(value: string) {
    if (phase !== 'awaiting' || !value.trim()) return;
    if (!onRespond(value)) {setText(value);setExpress(true);setError('回应尚未保存，内容已保留，请重试。');return;}
    setText('');setError('');setExpress(false);
  }
  async function fullscreen() {
    try {if (document.fullscreenElement) await document.exitFullscreen(); else await stage.current?.requestFullscreen();}
    catch {setError('当前窗口未能进入全屏，画面仍保留在这里。');}
  }
  function leave() {if (text.trim() || props.storageError) setConfirmation({type: 'leave'}); else onExit();}
  return <main ref={stage} className={styles.stage} aria-label="分段互动现场" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && phase === 'awaiting') {
      if (confirmation) return;
      if (express) setExpress(false); else setCollapsed(true);
      requestAnimationFrame(() => reopen.current?.focus());
    }
  }}>
    {media.kind === 'video' ? <video className={styles.media} style={{objectFit: fit}} src={media.url} playsInline controls onEnded={onEnded}/>
      : media.url ? <img className={styles.media} style={{objectFit: fit}} src={media.url} alt="当前故事的静态参考画面"/>
        : <div className={styles.noMedia}>尚未添加参考图片</div>}
    <header className={styles.header}>
      <div className={styles.heading}><button aria-label="返回我的游玩" onClick={leave}><ArrowLeft size={18}/></button><h1>{title}</h1></div>
      <div className={styles.tools}><button onClick={() => setFit(fit === 'cover' ? 'contain' : 'cover')}>{fit === 'cover' ? '完整画面' : '铺满画面'}</button><button aria-label="切换全屏" onClick={() => void fullscreen()}><Maximize size={18}/></button></div>
    </header>
    {simulated && <p className={styles.disclosure}>交互演练 · 静态参考 · 不调用模型</p>}
    {phase === 'generating' && <section className={styles.status} role="status"><strong>{simulated ? '模拟下一幕准备中…' : '下一幕正在生成'}</strong><p>{simulated ? '这里只演练等待与交互，不代表模型速度。' : '生成完成后即可观看。'}</p>{simulated && <button onClick={onFail}>模拟失败</button>}</section>}
    {phase === 'watching' && simulated && <section className={styles.status}><p>{context}</p><button onClick={onEnded}>模拟片段结束 <ArrowRight size={16}/></button><small>目前没有生成视频；此按钮仅用于演练播放完成事件。</small></section>}
    {phase === 'failed' && <section className={styles.status} role="alert"><strong>{simulated ? '模拟生成失败' : '这一幕暂时未完成'}</strong><p>当前设定仍然保留。</p><button onClick={onRetry}>重试这一幕</button></section>}
    {phase === 'awaiting' && (collapsed ? <button className={styles.reopen} ref={reopen} onClick={() => setCollapsed(false)}>继续回应 <ArrowRight size={16}/></button>
      : <section className={styles.deck} aria-label="这一刻的回应">
        <header><span>{express ? '用你自己的方式' : '你想如何回应？'}</span><button aria-label="收起回应" onClick={() => {setCollapsed(true);setExpress(false);requestAnimationFrame(() => reopen.current?.focus());}}><Minimize2 size={16}/></button></header>
        {express ? <form onSubmit={event => {event.preventDefault();respond(text);}}>
          <label htmlFor="scene-response">说一句话，或描述你想做的事</label>
          <textarea ref={field} id="scene-response" value={text} maxLength={2000} rows={3} onChange={event => changeDraft(event.target.value)}/>
          <footer><button type="button" onClick={() => setExpress(false)}>返回建议</button><button type="submit" disabled={!text.trim()}>回应并继续 <ArrowRight size={16}/></button></footer>
        </form> : <><div className={styles.choices}>{choices.map(choice => <div className={styles.choice} key={choice.id}>
          <button onClick={() => {if (text.trim() && text !== choice.text) {setConfirmation({type: 'respond', text: choice.text});return;}respond(choice.text);}}><span>{choice.title}<small>{choice.text}</small></span><ArrowRight size={16}/></button>
          <button aria-label={`修改：${choice.title}`} className={styles.edit} onClick={() => {
            if (text.trim() && text !== choice.text) {setConfirmation({type: 'replace', text: choice.text});return;}
            changeDraft(choice.text);setExpress(true);
          }}>修改</button>
        </div>)}</div><footer><small>{simulated ? '建议为本地示例，不是模型生成' : '下一步，由你决定'}</small><button onClick={() => setExpress(true)}>自己回应 <ArrowRight size={15}/></button></footer></>}
      </section>)}
    <div ref={portal} data-stage-overlay-host=""/>
    {confirmation && <StageConfirmation portalContainer={portal.current}
      title={confirmation.type === 'leave' ? (props.storageError ? '本机保存尚未完成' : '还有未发送的回应') : confirmation.type === 'respond' ? '改用这条回应并继续？' : '保留你刚才写的，还是采用这条建议？'}
      description={confirmation.type === 'leave' ? (props.storageError ? '离开可能丢失未保存的修改。' : simulated ? '已保存的草稿会留在这次演练里。' : '请先确认草稿已经保存。') : confirmation.type === 'respond' ? '确认后会发送这条建议，原来的未发送草稿将被替换。' : '只有确认后才会替换未发送的草稿。'}
      cancelLabel={confirmation.type === 'leave' ? '留在这里' : '保留原稿'}
      confirmLabel={confirmation.type === 'leave' ? '离开现场' : confirmation.type === 'respond' ? '改用建议并继续' : '采用建议'}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => {
        const action = confirmation;
        setConfirmation(null);
        if (action.type === 'leave') {onExit();return;}
        if (action.type === 'respond') {respond(action.text);return;}
        changeDraft(action.text);setExpress(true);
        requestAnimationFrame(() => field.current?.focus());
      }}/>}
    {(error || props.storageError) && <div className={styles.error} role="alert">{props.storageError || error}{props.storageError ? <button onClick={props.onRetrySave}>重试保存</button> : <button aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button>}</div>}
  </main>;
}
