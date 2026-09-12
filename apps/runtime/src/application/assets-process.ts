import {parseGetUpload} from '../contracts/asset-validation.js';
import type {AssetGetUpload} from '../contracts/asset.js';
import type {ImageBodySource} from '../ports/image-body-receiver.js';
import {AssetContext,UPLOAD_LEASE} from './assets-support.js';
export async function processAsset(c:AssetContext,input:AssetGetUpload,source:ImageBodySource){
 const value=parseGetUpload(input);c.check(value.datasetId);await c.revalidate();
 let claim=await c.write(async(scope,now)=>{const row=await c.upload(scope,value.uploadId);await c.noAsset(scope,row.assetId);
  if(!['reserved','processing','published','finalizing'].includes(row.status))throw Error('ASSET_STATE_INVALID');
  if(c.active(row,now))throw Error('ASSET_UPLOAD_BUSY');if(row.expiresAt.getTime()<=now.getTime())throw Error('ASSET_UPLOAD_EXPIRED');
  return c.change(scope,row,{status:'processing',processingToken:c.id(),leaseExpiresAt:new Date(now.getTime()+UPLOAD_LEASE),updatedAt:now});
 });
 try{return await c.deps.receiver.withBody(source,{inputSha256:claim.inputSha256,inputByteSize:String(claim.inputByteSize)},async bytes=>{
  const image=await c.deps.normalizer.normalize(bytes,{inputSha256:claim.inputSha256,inputByteSize:String(claim.inputByteSize)});
  if(image.mimeType!=='image/webp')throw Error('ASSET_OUTPUT_MISMATCH');
  await c.revalidate();
  claim=await c.write(async(scope,now)=>{const row=await c.upload(scope,claim.id);c.owned(row,claim,now);await c.noAsset(scope,row.assetId);
   if(row.outputSha256!==null&&!c.matches(c.metadata(row),image))throw Error('ASSET_OUTPUT_MISMATCH');
   return c.change(scope,row,{outputSha256:image.sha256,outputByteSize:BigInt(image.byteSize),outputWidth:image.width,outputHeight:image.height,updatedAt:now});
  });
  const files=await c.deps.openFiles();let evidence=await files.writeCandidate(claim.assetId,image.bytes,c.metadata(claim),source.signal);
  if(evidence.kind==='exists')evidence=await files.ensureDurableCandidate(claim.assetId,c.metadata(claim));c.evidence(claim,evidence);
  await c.revalidate();return c.write(async(scope,now)=>{const row=await c.upload(scope,claim.id);c.owned(row,claim,now);c.evidence(row,evidence);await c.noAsset(scope,row.assetId);
   return c.uploadDTO(await c.change(scope,row,{status:'published',processingToken:null,leaseExpiresAt:null,updatedAt:now}));
  });
 });}catch(error){return c.compensate(claim,error,'process');}
}
