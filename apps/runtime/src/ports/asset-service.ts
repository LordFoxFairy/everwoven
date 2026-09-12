import type {AssetBeginUpload,AssetGetUpload,AssetCompleteUpload,AssetGet,AssetCommandResult,UploadIntentDTO,AssetDTO} from '../contracts/asset.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {RuntimeServices} from '../application/runtime-services.js';
import type {ImageBodyReceiver,ImageBodySource} from './image-body-receiver.js';
import type {ImageNormalizer} from './image-normalizer.js';
import type {PrivateAssetStore,CleanupResult} from './private-asset-store.js';
export interface AssetServiceDependencies {
 owner:InternalOwnerContext;revalidate:()=>Promise<void>;openFiles:()=>Promise<PrivateAssetStore>;
 receiver:ImageBodyReceiver;normalizer:ImageNormalizer;services?:RuntimeServices;
}
export interface AssetService {
 begin(input:AssetBeginUpload):Promise<AssetCommandResult<UploadIntentDTO>>;
 getUpload(input:AssetGetUpload):Promise<UploadIntentDTO>;
 process(input:AssetGetUpload,source:ImageBodySource):Promise<UploadIntentDTO>;
 complete(input:AssetCompleteUpload):Promise<AssetCommandResult<AssetDTO>>;
 getBytes(input:AssetGet):Promise<{bytes:Buffer;data:AssetDTO}>;
 cleanup(input:AssetGetUpload):Promise<CleanupResult>;
}
