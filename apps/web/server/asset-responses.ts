import type {AssetCommandResult, AssetDTO, UploadIntentDTO} from 'runtime/contracts/asset';
export function assetOutput<T>(parse: (value: unknown) => T, value: unknown): T {
  try {return parse(value);} catch {throw Error('ASSET_RESPONSE_INVALID');}
}
export function commandOutput<T extends AssetDTO | UploadIntentDTO>(parse: (value: unknown) => T, value: unknown): AssetCommandResult<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
    Object.keys(value).some(key => key !== 'data' && key !== 'replayed') ||
    !('data' in value) || !('replayed' in value) || typeof value.replayed !== 'boolean') throw Error('ASSET_RESPONSE_INVALID');
  return {data: assetOutput(parse, value.data), replayed: value.replayed};
}
