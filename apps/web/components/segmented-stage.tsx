'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ArrowRight, Maximize, Minimize2, X} from 'lucide-react';
import styles from './segmented-stage.module.css';
import {StageConfirmation} from './stage-confirmation';

export type SegmentedStageProps = {
  title: string; context: string; phase: 'preparing' | 'loading' | 'generating' | 'watching' | 'awaiting' | 'confirming' | 'unknown' | 'failed';
  media: {kind: 'reference' | 'video' | 'empty'; url: string}; simulated: boolean;
  choices: {id: string; title: string; text: string}[];
  onEnded: (progress?:{positionMs:number;coveredMs:number}) => void; onRespond: (text: string) => boolean | Promise<boolean>; onExit: () => void;
  onRetry: () => void; onFail?: () => void;
  initialResponseDraft?: string; onDraftChange?: (text: string) => void;
  storageError?: string; onRetrySave?: () => void;
  onPlaybackStart?:()=>Promise<boolean>;onPlaybackProgress?:(progress:{positionMs:number;coveredMs:number})=>Promise<boolean>;
  managedResponse?: boolean; responsePending?: boolean; responseDirty?: boolean; onMediaError?: () => void;
  statusDetail?: string; retryLabel?: string; mediaRevision?: number; recoveryLabel?: string; overlay?: (container: HTMLElement | null) => ReactNode;
};

/** Presentation shared by rehearsal and future validated segment results. */
export function SegmentedStage(props: SegmentedStageProps) {
  const {title, context, phase, media, simulated, choices, onEnded, onRespond, onExit, onRetry, onFail} = props;
  const [collapsed, setCollapsed] = useState(false), [express, setExpress] = useState(Boolean(props.initialResponseDraft));
  const [text, setText] = useState(props.initialResponseDraft || ''), [error, setError] = useState(''), [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [confirmation, setConfirmation] = useState<{type: 'leave'} | {type: 'replace' | 'respond'; text: string} | null>(null);
  const [responding, setResponding] = useState(false);const responseFlight = useRef(false);
  const playbackGate=useRef<HTMLVideoElement|null>(null),startingVideo=useRef<HTMLVideoElement|null>(null);
  function coverage(video:HTMLVideoElement){let covered=0;for(let i=0;i<video.played.length;i++){if(video.played.start(i)>covered+.25)break;covered=Math.max(covered,video.played.end(i));}return{positionMs:Math.round(video.currentTime*1000),coveredMs:Math.round(covered*1000)};}
  const portal = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null), field = useRef<HTMLTextAreaElement>(null), reopen = useRef<HTMLButtonElement>(null);
  useEffect(() => {if (phase === 'awaiting') {setCollapsed(false);setExpress(Boolean(props.initialResponseDraft));} else if (phase === 'generating') {if(!props.managedResponse)setText('');setError('');}}, [phase]);
  useEffect(() => {if (express) field.current?.focus();}, [express]);
  useEffect(() => {if (props.managedResponse) setText(props.initialResponseDraft ?? '');}, [props.managedResponse, props.initialResponseDraft]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {if ((props.managedResponse ? props.responseDirty : text.trim()) || props.storageError) event.preventDefault();};
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [text, props.storageError, props.managedResponse, props.responseDirty]);
  function changeDraft(value: string) {if(responseFlight.current || props.responsePending)return;setText(value);props.onDraftChange?.(value);}
  async function respond(value: string) {
    if (phase !== 'awaiting' || !value.trim() || responseFlight.current || props.responsePending) return;
    responseFlight.current = true;setResponding(true);setText(value);
    try {
      if (!await onRespond(value)) {setExpress(true);if (!props.managedResponse) setError('回应尚未保存，内容已保留，请重试。');return;}
      if (!props.managedResponse) {setText('');setExpress(false);}setError('');
    } catch {setExpress(true);setError('回应尚未确认，内容已保留。');}
    finally {responseFlight.current = false;setResponding(false);}
  }
  async function fullscreen() {
    try {if (document.fullscreenElement) await document.exitFullscreen(); else await stage.current?.requestFullscreen();}
    catch {setError('当前窗口未能进入全屏，画面仍保留在这里。');}
  }
  function leave() {if(props.managedResponse){onExit();return;}if (text.trim() || props.storageError) setConfirmation({type: 'leave'}); else onExit();}
  return <main ref={stage} className={styles.stage} aria-label="分段互动现场" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && phase === 'awaiting') {
      if (confirmation) return;
      if (express) setExpress(false); else setCollapsed(true);
      requestAnimationFrame(() => reopen.current?.focus());
    }
  }}>
    {media.kind === 'video' ? <video key={`${media.url}:${props.mediaRevision ?? 0}`} className={styles.media} style={{objectFit: fit}} src={media.url} playsInline controls autoPlay={phase === 'watching'} onError={props.onMediaError} onPlay={event=>{
      if(!props.onPlaybackStart||phase!=='watching')return;
      const video=event.currentTarget;if(playbackGate.current===video)return;video.pause();
      if(startingVideo.current===video)return;startingVideo.current=video;video.currentTime=0;
      void props.onPlaybackStart().then(ready=>{if(!video.isConnected)return;if(ready){playbackGate.current=video;void video.play().catch(()=>setError('点击播放，继续观看这一幕。'));}}).finally(()=>{if(startingVideo.current===video)startingVideo.current=null;});
    }} onTimeUpdate={event=>{
      const video=event.currentTarget;if(phase!=='watching'||video.paused||playbackGate.current!==video||!props.onPlaybackProgress)return;
      void props.onPlaybackProgress(coverage(video)).then(ok=>{if(!ok&&video.isConnected)video.pause();});
    }} onEnded={event => {
      if (phase !== 'watching') return;
      const video = event.currentTarget;
      // A seek to the end is not viewing the scene. Browser ranges are a UX check, not server-side attestation.
      let covered = 0;
      for (let i = 0; i < video.played.length; i++) {if (video.played.start(i) > covered + .25) break;covered = Math.max(covered, video.played.end(i));}
      if (Number.isFinite(video.duration) && covered >= video.duration - .25) onEnded(coverage(video));
      else setError('还有一段画面尚未播放，请看完这一幕后继续。');
    }}/>
      : media.url ? <img className={styles.media} style={{objectFit: fit}} src={media.url} alt="当前故事的静态参考画面"/>
        : <div className={styles.noMedia}>{simulated ? '尚未添加参考图片' : <span>你的故事，即将展开</span>}</div>}
    <header className={styles.header}>
      <div className={styles.heading}><button aria-label="返回我的游玩" onClick={leave}><ArrowLeft size={18}/></button><h1>{title}</h1></div>
      <div className={styles.tools}><button onClick={() => setFit(fit === 'cover' ? 'contain' : 'cover')}>{fit === 'cover' ? '完整画面' : '铺满画面'}</button><button aria-label="切换全屏" onClick={() => void fullscreen()}><Maximize size={18}/></button></div>
    </header>
    {simulated && <p className={styles.disclosure}>交互演练 · 静态参考 · 不调用模型</p>}
    {['preparing', 'loading', 'confirming', 'unknown'].includes(phase) && <section className={styles.status} role="status">
      <strong>{phase === 'preparing' ? '故事已准备好' : phase === 'loading' ? '正在读取你的旅程' : phase === 'confirming' ? '正在确认这一幕' : '当前进展待核对'}</strong>
      <p>{props.statusDetail || context}</p>{['preparing', 'unknown'].includes(phase) && <button onClick={onRetry} disabled={props.responsePending}>{props.retryLabel || '读取当前进展'}<ArrowRight size={16}/></button>}
    </section>}
    {phase === 'generating' && <section className={styles.status} role="status"><strong>{simulated ? '模拟下一幕准备中…' : '下一幕正在生成'}</strong><p>{simulated ? '这里只演练等待与交互，不代表模型速度。' : '生成完成后即可观看。'}</p>{simulated && <button onClick={onFail}>模拟失败</button>}</section>}
    {phase === 'watching' && simulated && <section className={styles.status}><p>{context}</p><button onClick={()=>onEnded()}>模拟片段结束 <ArrowRight size={16}/></button><small>目前没有生成视频；此按钮仅用于演练播放完成事件。</small></section>}
    {phase === 'failed' && <section className={styles.status} role="alert"><strong>{simulated ? '模拟生成失败' : '这一幕暂时未完成'}</strong><p>{props.statusDetail || '当前设定仍然保留。'}</p><button onClick={onRetry}>{props.retryLabel || (simulated ? '重试这一幕' : '读取当前进展')}</button></section>}
    {phase === 'awaiting' && (collapsed ? <button className={styles.reopen} ref={reopen} onClick={() => setCollapsed(false)}>继续回应 <ArrowRight size={16}/></button>
      : <section className={styles.deck} aria-label="这一刻的回应">
        <header><span>{express ? '用你自己的方式' : '你想如何回应？'}</span><button aria-label="收起回应" onClick={() => {setCollapsed(true);setExpress(false);requestAnimationFrame(() => reopen.current?.focus());}}><Minimize2 size={16}/></button></header>
        {express ? <form onSubmit={event => {event.preventDefault();void respond(text);}}>
          <label htmlFor="scene-response">说一句话，或描述你想做的事</label>
          <textarea ref={field} id="scene-response" value={text} maxLength={2000} rows={3} disabled={responding || props.responsePending} onChange={event => changeDraft(event.target.value)}/>
          <footer><button type="button" onClick={() => setExpress(false)}>返回建议</button><button type="submit" disabled={!text.trim() || responding || props.responsePending}>{responding ? '正在准备…' : '回应并继续'} <ArrowRight size={16}/></button></footer>
        </form> : <><div className={styles.choices}>{choices.map(choice => <div className={styles.choice} key={choice.id}>
          <button disabled={responding || props.responsePending} onClick={() => {if (text.trim() && text !== choice.text) {setConfirmation({type: 'respond', text: choice.text});return;}void respond(choice.text);}}><span>{choice.title}<small>{choice.text}</small></span><ArrowRight size={16}/></button>
          <button disabled={responding || props.responsePending} aria-label={`修改：${choice.title}`} className={styles.edit} onClick={() => {
            if (text.trim() && text !== choice.text) {setConfirmation({type: 'replace', text: choice.text});return;}
            changeDraft(choice.text);setExpress(true);
          }}>修改</button>
        </div>)}</div><footer><small>{simulated ? '建议为本地示例，不是模型生成' : '下一步，由你决定'}</small><button onClick={() => setExpress(true)}>自己回应 <ArrowRight size={15}/></button></footer></>}
      </section>)}
    <div ref={portal} data-stage-overlay-host=""/>
    {props.overlay?.(portal.current)}
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
        if (responding || props.responsePending) return;
        if (action.type === 'respond') {respond(action.text);return;}
        changeDraft(action.text);setExpress(true);
        requestAnimationFrame(() => field.current?.focus());
      }}/>}
    {(error || props.storageError) && <div className={styles.error} role="alert">{props.storageError || error}{props.storageError ? <button onClick={props.onRetrySave} disabled={props.responsePending}>{props.recoveryLabel || '重试保存'}</button> : <button aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button>}</div>}
  </main>;
}
