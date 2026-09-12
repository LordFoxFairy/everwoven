import type {AssetService} from 'runtime/host';
import {guardLocalRequest, localRuntimeConfig, sessionToken} from './local-boundary';
export const ASSET_DATASET_HEADER = 'x-everwoven-dataset-id';
export type WithAssets = <T>(work: (assets: AssetService) => Promise<T>) => Promise<T>;
export function localAssetAccess(request: Request, env: Record<string, string | undefined>): WithAssets {
  return async work => {
    const config = localRuntimeConfig(env);
    if (!config) throw Error('LOCAL_SESSION_INVALID');
    guardLocalRequest(request, config);
    if (request.headers.has('host') && request.headers.get('host') !== new URL(config.origin).host) throw Error('LOCAL_ORIGIN_DENIED');
    const token = sessionToken(request);
    if (!token) throw Error('LOCAL_SESSION_INVALID');
    // No body or asset directory is opened here. Host authenticates; service validates intent/lease.
    const host = await import('runtime/host');
    return host.withLocalAssets(config.directory, config.environment, token, work);
  };
}
