import {parseGetAsset,parseGetUpload} from '../contracts/asset-validation.js';
import type {AssetGet,AssetGetUpload} from '../contracts/asset.js';
import {issueDeletionPermitForDeleting} from '../infrastructure/media/private-asset-deletion.js';
import {AssetContext,permanent} from './assets-support.js';
export async function cleanupAsset(c:AssetContext,input:AssetGetUpload){
 const value=parseGetUpload(input);c.check(value.datasetId);await c.revalidate();
 // T1 commits before opening files or entering the independently injected coordinator's T2.
 const row=await c.write(async(scope,now)=>{const row=await c.upload(scope,value.uploadId);if(row.status==='completed')throw Error('ASSET_CLEANUP_NOT_ALLOWED');
  if(await scope.hasAssetIdentity(row.assetId,c.key(row.assetId)))throw Error('ASSET_CLEANUP_NOT_ALLOWED');
  if(c.active(row,now)||(!['failed','deleting'].includes(row.status)&&row.expiresAt.getTime()>now.getTime()))throw Error('ASSET_CLEANUP_NOT_ALLOWED');
  if(row.status==='deleting')return row;
  return c.change(scope,row,{status:'deleting',processingToken:null,leaseExpiresAt:null,updatedAt:now});
 });
 await c.revalidate();const permit=issueDeletionPermitForDeleting({...c.owner,assetId:row.assetId,status:'deleting'}),files=await c.deps.openFiles();return files.removeDeletingCandidate(row.assetId,permit);
}
export async function getAssetBytes(c:AssetContext,input:AssetGet){
 const value=parseGetAsset(input);c.check(value.datasetId);await c.revalidate();
 const row=await c.read(async scope=>{const row=await c.asset(scope,value.assetId);if(row.status!=='ready'||row.deletedAt!==null)throw Error('ASSET_UNAVAILABLE');return row;});
 const expected={mimeType:'image/webp' as const,sha256:row.sha256,byteSize:String(row.byteSize),width:row.width,height:row.height};
 let verified;
 try{const files=await c.deps.openFiles();verified=await files.verifyCandidate(row.id,expected);}catch(error){
  if(permanent(error)){await c.revalidate();await c.write(async(scope,now)=>{const current=await c.asset(scope,row.id);if(current.revision===row.revision&&current.status==='ready'&&current.deletedAt===null){if(current.revision>=2147483647)throw Error('REVISION_EXHAUSTED');await scope.markUnavailable(current,now);}});}
  throw error;
 }
 await c.revalidate();await c.read(async scope=>{const current=await c.asset(scope,row.id);if(current.status!=='ready'||current.deletedAt!==null||current.revision!==row.revision)throw Error('ASSET_UNAVAILABLE');});
 if(!c.matches(expected,verified.metadata)||!Buffer.isBuffer(verified.bytes))throw Error('ASSET_EVIDENCE_INVALID');return {bytes:verified.bytes,data:c.assetDTO(row)};
}
