import {parseBeginUpload,parseGetUpload} from '../contracts/asset-validation.js';
import type {AssetService,AssetServiceDependencies} from '../ports/asset-service.js';
import type {AssetStore,UploadRecord} from '../ports/asset-store.js';
import {AssetContext,UPLOAD_TTL,safe} from './assets-support.js';
import {processAsset} from './assets-process.js';
import {completeAsset} from './assets-complete.js';
import {getAssetBytes,cleanupAsset} from './assets-recovery.js';
export function createAssets(store:AssetStore,deps:AssetServiceDependencies):AssetService{
 const c=new AssetContext(store,deps);
 return {
  begin:input=>safe(async()=>{const value=parseBeginUpload(input);c.check(value.datasetId);await c.revalidate();const command=c.command('begin',value);
   return c.write(async(scope,now)=>{const replay=await c.replayBegin(scope,value,command);if(replay)return replay;
    const id=c.id(),assetId=c.id();await c.noAsset(scope,assetId);if(await scope.countUploadIdentities(assetId)!==0)throw Error('ASSET_IDENTITY_CONFLICT');
    const row:UploadRecord={id,ownerId:c.owner.ownerId,assetId,inputSha256:value.inputSha256,inputByteSize:BigInt(value.inputByteSize),originalName:value.originalName,rightsDeclaration:value.rightsDeclaration,status:'reserved',outputSha256:null,outputByteSize:null,outputWidth:null,outputHeight:null,processingToken:null,leaseExpiresAt:null,createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+UPLOAD_TTL),revision:1};
    // One atomic begin creates one upload and its receipt with the same server UUIDv7.
    // The cross-table shared primary identity binds the command independently of response JSON.
    const data=c.uploadDTO(await scope.insertUpload(row));await c.receipt(scope,id,value.commandId,command,data,now);return {data,replayed:false};
   });
  }),
  getUpload:input=>safe(async()=>{const value=parseGetUpload(input);c.check(value.datasetId);await c.revalidate();return c.read(async scope=>c.uploadDTO(await c.upload(scope,value.uploadId)));}),
  process:(input,source)=>safe(()=>processAsset(c,input,source)),complete:input=>safe(()=>completeAsset(c,input)),getBytes:input=>safe(()=>getAssetBytes(c,input)),cleanup:input=>safe(()=>cleanupAsset(c,input)),
 };
}
