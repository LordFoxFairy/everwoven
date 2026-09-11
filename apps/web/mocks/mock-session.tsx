'use client';
import {useEffect, useState, useRef} from 'react';
import type {RehearsalSave} from '../components/storage';
import {appendTurn} from '../../../packages/domain/src/story';
import {SegmentedStage} from '../components/segmented-stage';
import {useStoryArtwork} from '../components/story-assets';
import {advanceDemo, demoSuggestions, restoreDemo, type DemoEvent} from './session';

/** Frontend fixture controller. Never imports a model adapter or a tRPC client. */
export function MockSession({save, onChange, onExit}: {save: RehearsalSave; onChange: (save: RehearsalSave) => boolean; onExit: () => void}) {
  const [checkpoint, setCheckpoint] = useState(() => restoreDemo(save.mockSession, save.turns.length));
  const [pendingSave, setPendingSave] = useState<RehearsalSave | null>(null);
  const state = checkpoint.state;
  const responding = useRef(false);
  const art = useStoryArtwork(save.story);
  function persist(next: RehearsalSave) {
    if (!onChange(next)) {setPendingSave(next);return false;}
    setPendingSave(null);setCheckpoint(next.mockSession!);return true;
  }
  function dispatch(event: DemoEvent) {
    const nextState = advanceDemo(state, event);
    if (nextState === state) return;
    persist({...save, mockSession: {...checkpoint, state: nextState}});
  }
  useEffect(() => {
    responding.current = false;
    if (state.phase !== 'generating') return;
    const timer = setTimeout(() => dispatch({type: 'generated', turn: state.turn}), 1200);
    return () => clearTimeout(timer);
  }, [state.phase, state.turn]);
  return <SegmentedStage title={save.story.title} context={save.story.opening} phase={state.phase}
    media={{kind: 'reference', url: art.url || ''}} simulated choices={demoSuggestions(save.story.character)}
    initialResponseDraft={checkpoint.responseDraft}
    onDraftChange={text => {persist({...save, mockSession: {...checkpoint, responseDraft: text}});}}
    storageError={pendingSave ? '本机保存未完成，当前内容仍在。请重试保存后再离开。' : ''}
    onRetrySave={() => {if(pendingSave) persist(pendingSave);}}
    onEnded={() => dispatch({type: 'ended'})} onExit={onExit}
    onRetry={() => dispatch({type: 'retry'})} onFail={() => dispatch({type: 'fail'})}
    onRespond={text => {
      if (responding.current || state.phase !== 'awaiting' || !text.trim()) return false;
      responding.current = true;
      const next = {...appendTurn(save, text), mockSession: {version: 1 as const,
        state: advanceDemo(state, {type: 'respond', text}), responseDraft: ''}};
      // The reply and its checkpoint share one atomic browser write, not two keys.
      if (!persist(next)) {responding.current = false;return false;}
      return true;
    }}/>
}
