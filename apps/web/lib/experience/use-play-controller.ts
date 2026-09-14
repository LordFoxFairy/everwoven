'use client';
import {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {PlayController} from './play-controller';
import {createGenerationClient} from './playback-client';
import {writePlayRoute} from './play-route';
import {useAuthoringSession} from '../authoring/session-context';
export function usePlayController() {
 const session = useAuthoringSession(), [client] = useState(createGenerationClient), [controller] = useState(() => new PlayController(writePlayRoute));
 const connected = session.state.status === 'connected';
 useLayoutEffect(() => controller.bind({client, connected, datasetId: session.state.datasetId, invalidate: session.invalidate}), [controller, client, connected, session.state.datasetId, session.invalidate]);
 const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
 useEffect(() => {
  if (!state.visible || !connected || state.datasetChanged || state.busy || state.reading || state.play?.status !== 'generating') return;
  const timer = setTimeout(() => void controller.refresh(), 2000);return () => clearTimeout(timer);
 }, [controller, state, connected]);
 useEffect(() => {
  if (!state.busy && !controller.draftDirty()) return;
  const guard = (event: BeforeUnloadEvent) => {event.preventDefault();event.returnValue = '';};
  window.addEventListener('beforeunload', guard);return () => window.removeEventListener('beforeunload', guard);
 }, [state.busy, state.draft]);
 useEffect(()=>{
  if(!state.visible||!connected||state.datasetChanged||state.busy||state.reading||state.error||state.draftUnknown||!controller.draftDirty())return;
  const timer=setTimeout(()=>void controller.saveDraft(),800);return()=>clearTimeout(timer);
 },[controller,state,connected]);
 useEffect(() => () => controller.suspend(), [controller]);
 return {controller, state};
}
