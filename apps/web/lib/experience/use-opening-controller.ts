'use client';
import {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {OpeningController} from './opening-controller';
import type {OpeningClient} from './opening-ports';
import {useAuthoringSession} from '../authoring/session-context';
export function useOpeningController(client: OpeningClient) {
  const session = useAuthoringSession(), [controller] = useState(() => new OpeningController()), connected = session.state.status === 'connected';
  useLayoutEffect(() => {controller.bind({client, connected, datasetId: session.state.datasetId, invalidate: session.invalidate});}, [controller, client, connected, session.state.datasetId, session.invalidate]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {if (state.origin === 'draft' && state.visible && connected) void controller.load();}, [controller, client, connected, session.state.datasetId, session.invalidate, state.visible, state.origin, state.source?.id, state.source?.revision]);
  useEffect(() => () => controller.suspend(), [controller]);
  useEffect(() => {
    if (!state.busy && !state.unknown) return;
    const guard = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [state.busy, state.unknown]);
  return {controller, state};
}
