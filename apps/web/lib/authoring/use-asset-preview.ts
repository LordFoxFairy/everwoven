'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {AssetPreviewState, AssetReadBinding, AssetRef} from './asset-ports';
import {assetTransportError, AssetTransportError} from './asset-failure';
import {scheduleAssetRead} from './asset-read-budget';
type View = Omit<AssetPreviewState, 'retry'>;
const view = (status: View['status'], error: View['error'] = null): View => ({status, url: null, error});
function initial(ref: AssetRef | null, binding: AssetReadBinding | null): View {
  if (!ref) return view('empty');
  if (!binding || binding.client.kind !== ref.kind) return view('error', new AssetTransportError('internal').failure);
  if (ref.kind === 'formal') {
    if (!binding.connected) return view('disconnected', new AssetTransportError('session').failure);
    if (ref.datasetId !== binding.datasetId) return view('error', new AssetTransportError('datasetChanged').failure);
  }
  return view('loading');
}
export function useAssetPreview(ref: AssetRef | null, binding: AssetReadBinding | null): AssetPreviewState {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  // Value identity, not the caller's freshly allocated ref/binding object, defines a read epoch.
  const scope = useMemo(() => ({ref, binding, initial: initial(ref, binding)}),
    [ref?.kind, ref?.id, ref?.kind === 'formal' ? ref.datasetId : null, binding?.client, binding?.connected, binding?.datasetId, binding?.invalidate, attempt]);
  const [settled, setSettled] = useState<{scope: typeof scope; value: View} | null>(null);
  useEffect(() => {
    if (scope.initial.status !== 'loading' || !scope.ref || !scope.binding) return;
    const {ref: value, binding: current} = scope;
    const abort = new AbortController(); let live = true, url: string | null = null;
    void scheduleAssetRead(() => {
      if (current.client.kind === 'formal' && value.kind === 'formal') return current.client.read(value, abort.signal);
      if (current.client.kind === 'demo' && value.kind === 'demo') return current.client.read(value, abort.signal);
      return Promise.reject(new AssetTransportError('internal'));
    }, abort.signal).then(blob => {
      if (!live) return;
      url = URL.createObjectURL(blob);
      setSettled({scope, value: {status: 'ready', url, error: null}});
    }).catch(cause => {
      if (!live) return;
      const error = assetTransportError(cause).failure;
      setSettled({scope, value: view(error.kind === 'missing' ? 'missing' : error.kind === 'session' || error.kind === 'forbidden' ? 'disconnected' : 'error', error)});
      if (error.kind === 'session' || error.kind === 'forbidden' || error.kind === 'datasetChanged') current.invalidate();
    });
    return () => {live = false; abort.abort(); if (url) URL.revokeObjectURL(url);};
  }, [scope]);
  // Never expose an old dataset URL for even the render before effect cleanup.
  return {...(settled?.scope === scope ? settled.value : scope.initial), retry};
}
