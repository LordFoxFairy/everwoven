import {readImageAsset, importImageAsset} from '../assets/store';
import type {DemoAssetClient} from './asset-ports';
import {AssetTransportError, aborted} from './asset-failure';
export function createDemoAssetClient(): DemoAssetClient {
  return {
    kind: 'demo',
    async read(ref, signal) {
      if (ref.kind !== 'demo') throw new AssetTransportError('invalid'); if (signal?.aborted) throw aborted();
      let image;
      try {image = await readImageAsset(ref.id, 'demo');} catch {throw new AssetTransportError('internal');}
      if (signal?.aborted) throw aborted(); if (!image) throw new AssetTransportError('missing'); return image.blob;
    },
    async importImage(file) {try {const image = await importImageAsset(file, 'demo'); return {kind: 'demo', id: image.id};} catch {throw new AssetTransportError('invalid');}},
  };
}
