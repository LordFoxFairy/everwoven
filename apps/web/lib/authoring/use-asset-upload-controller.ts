'use client';
import {useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {AssetUploadController} from './asset-controller';
import type {AssetUploadBinding} from './asset-ports';
/** Hold this in the editor container, not the conditional image picker tab. */
export function useAssetUploadController(binding: AssetUploadBinding) {
  const [controller] = useState(() => new AssetUploadController());
  useLayoutEffect(() => {controller.bind(binding);}, [controller, binding.client, binding.connected, binding.datasetId, binding.invalidate, binding.editingKey]);
  useLayoutEffect(() => () => controller.suspend(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return {controller, state};
}
