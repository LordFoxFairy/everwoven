import {parseCompleteUpload} from '../contracts/asset-validation.js';
import type {AssetCompleteUpload} from '../contracts/asset.js';
import type {UploadRecord,AssetRecord} from '../ports/asset-store.js';
import {AssetContext,UPLOAD_LEASE} from './assets-support.js';
export async function completeAsset(c:AssetContext,input:AssetCompleteUpload){
 const value=parseCompleteUpload(input);c.check(value.datasetId);await c.revalidate();const command=c.command('complete',value);
 const initial=await c.write(async(scope,now)=>{
  const replay=await c.replayComplete(scope,value,command);if(replay)return {result:replay};
  const row=await c.upload(scope,value.uploadId);
  if(row.status==='completed'){const asset=await c.asset(scope,row.assetId);if(asset.status!=='ready'||asset.deletedAt!==null)throw Error('ASSET_UNAVAILABLE');const data=c.assetDTO(asset);c.assertAssetBinding(row,data,'ASSET_IDENTITY_CONFLICT');await c.receipt(scope,c.id(),value.commandId,command,data,now);return {result:{data,replayed:false}};}
  // TTL gates new claims only; an already-issued valid token may finish across this boundary.
  if(row.expiresAt.getTime()<=now.getTime())throw Error('ASSET_UPLOAD_EXPIRED');
  await c.noAsset(scope,row.assetId);
  if(!['published','processing','finalizing'].includes(row.status)||row.outputSha256===null)throw Error('ASSET_STATE_INVALID');
  if(c.active(row,now))throw Error('ASSET_UPLOAD_BUSY');
  const claim=await c.change(scope,row,{status:'finalizing',processingToken:c.id(),leaseExpiresAt:new Date(now.getTime()+UPLOAD_LEASE),updatedAt:now});return {claim};
 });
 if(initial.result)return initial.result;const claim=initial.claim as UploadRecord;
 try{
  const files=await c.deps.openFiles(),evidence=await files.ensureDurableCandidate(claim.assetId,c.metadata(claim));c.evidence(claim,evidence);await c.revalidate();
  return await c.write(async(scope,now)=>{
   const replay=await c.replayComplete(scope,value,command);if(replay)return replay;
   const row=await c.upload(scope,claim.id);c.owned(row,claim,now);c.evidence(row,evidence);await c.noAsset(scope,row.assetId);
   const asset:AssetRecord={id:row.assetId,ownerId:c.owner.ownerId,storageKey:c.key(row.assetId),sha256:row.outputSha256!,mimeType:'image/webp',byteSize:row.outputByteSize!,width:row.outputWidth!,height:row.outputHeight!,originalName:row.originalName,rightsDeclaration:row.rightsDeclaration,status:'ready',deletedAt:null,createdAt:now,updatedAt:now,revision:1};
   const data=c.assetDTO(await scope.insertAsset(asset));c.assertAssetBinding(row,data,'ASSET_IDENTITY_CONFLICT');await c.change(scope,row,{status:'completed',processingToken:null,leaseExpiresAt:null,updatedAt:now});await c.receipt(scope,c.id(),value.commandId,command,data,now);return {data,replayed:false};
  });
 }catch(error){return c.compensate(claim,error,'complete');}
}
