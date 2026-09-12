import {createHash} from 'node:crypto';
import {isBusinessId} from '../contracts/primitives.js';
import {parseOwner} from '../contracts/story-draft-validation.js';
import {parseUploadIntentDTO,parseAssetDTO} from '../contracts/asset-validation.js';
import type {AssetDTO,UploadIntentDTO,AssetBeginUpload,AssetCompleteUpload} from '../contracts/asset.js';
import type {AssetServiceDependencies} from '../ports/asset-service.js';
import type {AssetStore,AssetReadScope,AssetWriteScope,UploadRecord,UploadPatch,AssetRecord} from '../ports/asset-store.js';
import type {DurableCandidate,PrivateAssetMetadata} from '../ports/private-asset-store.js';
import {currentTime,nextId,systemServices} from './runtime-services.js';
export const UPLOAD_TTL=86400000,UPLOAD_LEASE=120000;
const known=new Set(['DATASET_CHANGED','UNAUTHORIZED','FORBIDDEN','OWNER_UNAVAILABLE','INVALID_OWNER','INVALID_ASSET_COMMAND','INVALID_ASSET_QUERY','STORED_ASSET_INVALID','ASSET_NOT_FOUND','ASSET_UPLOAD_NOT_FOUND','ASSET_IDENTITY_CONFLICT','ASSET_UPLOAD_BUSY','ASSET_UPLOAD_EXPIRED','ASSET_STATE_INVALID','ASSET_LEASE_LOST','ASSET_OUTPUT_MISMATCH','ASSET_EVIDENCE_INVALID','ASSET_CLEANUP_NOT_ALLOWED','ASSET_UNAVAILABLE','IDEMPOTENCY_CONFLICT','COMMAND_RECEIPT_INVALID','REVISION_EXHAUSTED','CLOCK_INVALID','ID_FACTORY_INVALID','ASSET_OPERATION_FAILED']);
// Exact port/Host identifiers only; never reflect an arbitrary prefix-shaped diagnostic.
const boundaryErrors=new Set([
 'LOCAL_SESSION_INVALID','LOCAL_HOST_INVALID',
 'PRIVATE_ASSET_INVALID_ARGUMENT','PRIVATE_ASSET_BINDING_MISMATCH','PRIVATE_ASSET_STORE_INVALIDATED','PRIVATE_ASSET_IO','PRIVATE_ASSET_ABORTED','PRIVATE_ASSET_NOT_FOUND','PRIVATE_ASSET_UNSAFE_FILE','PRIVATE_ASSET_INVALID_PERMIT','PRIVATE_ASSET_CONTENT_INVALID',
 'INVALID_IMAGE_INPUT','IMAGE_TOO_LARGE','IMAGE_HASH_MISMATCH','IMAGE_SIZE_MISMATCH','UNSUPPORTED_IMAGE_FORMAT','INVALID_IMAGE_DATA','IMAGE_DIMENSIONS_INVALID','IMAGE_ANIMATED','IMAGE_DECODER_BUSY','IMAGE_PROCESSING_TIMEOUT','IMAGE_OUTPUT_TOO_LARGE',
 'IMAGE_BODY_INVALID_INPUT','IMAGE_BODY_BUSY','IMAGE_BODY_ABORTED','IMAGE_BODY_TIMEOUT','IMAGE_BODY_TOO_LARGE','IMAGE_BODY_SIZE_MISMATCH','IMAGE_BODY_HASH_MISMATCH','IMAGE_BODY_READ_FAILED',
 'ASSET_CLEANUP_INVALID_SCOPE','ASSET_CLEANUP_NOT_ALLOWED','ASSET_CLEANUP_FAILED','ASSET_CLEANUP_INVALID_CALLBACK',
]);
export function code(error:unknown):string{return error instanceof Error?error.message:'';}
export function sanitize(error:unknown):Error{const message=code(error);return Error(known.has(message)||boundaryErrors.has(message)?message:'ASSET_OPERATION_FAILED');}
export async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw sanitize(error);}}
export const corrupt=(error:unknown)=>['PRIVATE_ASSET_CONTENT_INVALID'].includes(code(error));
export const permanent=(error:unknown)=>['PRIVATE_ASSET_NOT_FOUND','PRIVATE_ASSET_CONTENT_INVALID'].includes(code(error));
export class AssetContext {
 readonly owner;readonly services;
 constructor(readonly store:AssetStore,readonly deps:AssetServiceDependencies){parseOwner(deps.owner);if(typeof deps.revalidate!=='function'||typeof deps.openFiles!=='function'||!deps.receiver||!deps.normalizer)throw Error('ASSET_OPERATION_FAILED');this.owner=Object.freeze({...deps.owner});this.services=deps.services??systemServices;}
 check(datasetId:string){if(datasetId!==this.owner.datasetId)throw Error('DATASET_CHANGED');}
 key(id:string){return `assets/${this.owner.datasetId}/${id}.webp`;}
 now(){return currentTime(this.services);}
 id(){return nextId(this.services);}
 read<T>(work:(scope:AssetReadScope)=>Promise<T>){return this.store.read(this.owner.ownerId,work);}
 write<T>(work:(scope:AssetWriteScope,now:Date)=>Promise<T>){return this.store.write(this.owner.ownerId,scope=>work(scope,this.now()));}
 revalidate(){return this.deps.revalidate();}
 uploadDTO(row:UploadRecord):UploadIntentDTO{try{return parseUploadIntentDTO({id:row.id,datasetId:this.owner.datasetId,assetId:row.assetId,inputSha256:row.inputSha256,inputByteSize:String(row.inputByteSize),originalName:row.originalName,rightsDeclaration:row.rightsDeclaration,status:row.status,outputSha256:row.outputSha256,outputByteSize:row.outputByteSize===null?null:String(row.outputByteSize),outputWidth:row.outputWidth,outputHeight:row.outputHeight,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),expiresAt:row.expiresAt.toISOString(),revision:row.revision});}catch{throw Error('STORED_ASSET_INVALID');}}
 assetDTO(row:AssetRecord):AssetDTO{try{return parseAssetDTO({id:row.id,datasetId:this.owner.datasetId,sha256:row.sha256,mimeType:row.mimeType,byteSize:String(row.byteSize),originalName:row.originalName,rightsDeclaration:row.rightsDeclaration,width:row.width,height:row.height,status:row.status,deletedAt:row.deletedAt?.toISOString()??null,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),revision:row.revision});}catch{throw Error('STORED_ASSET_INVALID');}}
 async upload(scope:AssetReadScope,id:string){const row=await scope.findUpload(id);if(!row)throw Error('ASSET_UPLOAD_NOT_FOUND');if(row.ownerId!==this.owner.ownerId||await scope.countUploadIdentities(row.assetId)!==1)throw Error('ASSET_IDENTITY_CONFLICT');this.uploadDTO(row);if(row.processingToken!==null&&!isBusinessId(row.processingToken))throw Error('STORED_ASSET_INVALID');if((row.processingToken===null)!==(row.leaseExpiresAt===null)||row.leaseExpiresAt&&(!Number.isFinite(row.leaseExpiresAt.getTime())))throw Error('STORED_ASSET_INVALID');return row;}
 async asset(scope:AssetReadScope,id:string){const row=await scope.findAsset(id);if(!row)throw Error('ASSET_NOT_FOUND');if(row.ownerId!==this.owner.ownerId||row.storageKey!==this.key(id))throw Error('ASSET_IDENTITY_CONFLICT');this.assetDTO(row);return row;}
 async noAsset(scope:AssetReadScope,id:string){if(await scope.hasAssetIdentity(id,this.key(id)))throw Error('ASSET_IDENTITY_CONFLICT');}
 async change(scope:AssetWriteScope,row:UploadRecord,patch:UploadPatch){if(row.revision>=2147483647)throw Error('REVISION_EXHAUSTED');const next={...row,...patch,revision:row.revision+1};this.uploadDTO(next);if(await scope.casUpload(row,patch)!==1)throw Error('ASSET_LEASE_LOST');return next;}
 active(row:UploadRecord,now:Date){return row.leaseExpiresAt!==null&&row.leaseExpiresAt.getTime()>now.getTime();}
 owned(row:UploadRecord,claim:UploadRecord,now:Date){if(row.processingToken!==claim.processingToken||row.status!==claim.status||row.revision!==claim.revision||!this.active(row,now))throw Error('ASSET_LEASE_LOST');}
 metadata(row:UploadRecord):PrivateAssetMetadata{this.uploadDTO(row);if(row.outputSha256===null)throw Error('ASSET_STATE_INVALID');return {mimeType:'image/webp',sha256:row.outputSha256,byteSize:String(row.outputByteSize),width:row.outputWidth!,height:row.outputHeight!};}
 matches(a:PrivateAssetMetadata,b:PrivateAssetMetadata){return a.mimeType===b.mimeType&&a.sha256===b.sha256&&a.byteSize===b.byteSize&&a.width===b.width&&a.height===b.height;}
 evidence(row:UploadRecord,e:DurableCandidate){if(e.kind!=='durable'||e.datasetId!==this.owner.datasetId||e.assetId!==row.assetId||!this.matches(this.metadata(row),e.metadata))throw Error('ASSET_EVIDENCE_INVALID');}
 command(action:string,input:AssetBeginUpload|AssetCompleteUpload){const type=`authoring.asset.${action}.v1`;return {type,hash:createHash('sha256').update(JSON.stringify([type,this.owner.ownerId,this.owner.datasetId,input])).digest('hex')};}
 private async replay<T extends AssetDTO|UploadIntentDTO>(scope:AssetWriteScope,id:string,command:{type:string;hash:string},parse:(v:unknown)=>T){const receipt=await scope.findReceipt(id);if(!receipt)return null;if(receipt.commandType!==command.type||receipt.payloadHash!==command.hash)throw Error('IDEMPOTENCY_CONFLICT');try{const data=parse(receipt.response);if(!isBusinessId(receipt.id)||receipt.schemaVersion!==1||data.datasetId!==this.owner.datasetId)throw Error();return {data,receiptId:receipt.id};}catch{throw Error('COMMAND_RECEIPT_INVALID');}}
 /** Receipt bindings inspect immutable intent fields only, never its current lifecycle/lease. */
 private async receiptUpload(scope:AssetReadScope,id:string){
  const row=await scope.findUpload(id);
  if(!row||row.id!==id||row.ownerId!==this.owner.ownerId||!isBusinessId(row.assetId)||await scope.countUploadIdentities(row.assetId)!==1)throw Error('COMMAND_RECEIPT_INVALID');
  return row;
 }
 async replayBegin(scope:AssetWriteScope,input:AssetBeginUpload,command:{type:string;hash:string}){
  const replay=await this.replay(scope,input.commandId,command,parseUploadIntentDTO);if(!replay)return null;
  const data=replay.data;
  // The owner/command lookup supplies the independently persisted upload identity.
  // Never allow a complete response DTO for another same-content upload to self-authenticate.
  if(data.id!==replay.receiptId)throw Error('COMMAND_RECEIPT_INVALID');
  const row=await this.receiptUpload(scope,replay.receiptId);
  for(const field of ['inputSha256','originalName','rightsDeclaration'] as const){
   if(data[field]!==input[field]||row[field]!==input[field])throw Error('COMMAND_RECEIPT_INVALID');
  }
  if(data.assetId!==row.assetId||data.inputByteSize!==input.inputByteSize||String(row.inputByteSize)!==input.inputByteSize||
   Date.parse(data.createdAt)!==row.createdAt.getTime()||Date.parse(data.expiresAt)!==row.expiresAt.getTime()||
   data.status!=='reserved'||data.revision!==1||data.updatedAt!==data.createdAt||
   data.outputSha256!==null||data.outputByteSize!==null||data.outputWidth!==null||data.outputHeight!==null)throw Error('COMMAND_RECEIPT_INVALID');
  return {data,replayed:true};
 }
 async replayComplete(scope:AssetWriteScope,input:AssetCompleteUpload,command:{type:string;hash:string}){
  const replay=await this.replay(scope,input.commandId,command,parseAssetDTO);if(!replay)return null;
  const data=replay.data,row=await this.receiptUpload(scope,input.uploadId);
  this.assertAssetBinding(row,data,'COMMAND_RECEIPT_INVALID');
  // New commands on completed intents snapshot the current ready Asset (not necessarily revision 1).
  // A replay returns that snapshot even if the current Asset is unavailable/deleted or has a newer revision.
  return {data,replayed:true};
 }
 /** The same fixed binding is enforced before first issuance and on historical replay. */
 assertAssetBinding(row:UploadRecord,data:AssetDTO,error:'COMMAND_RECEIPT_INVALID'|'ASSET_IDENTITY_CONFLICT'){
  if(data.id!==row.assetId||data.sha256!==row.outputSha256||data.byteSize!==String(row.outputByteSize)||
   data.width!==row.outputWidth||data.height!==row.outputHeight||data.originalName!==row.originalName||
   data.rightsDeclaration!==row.rightsDeclaration||data.status!=='ready'||data.deletedAt!==null)throw Error(error);
 }
 receipt(scope:AssetWriteScope,receiptId:string,commandId:string,command:{type:string;hash:string},data:AssetDTO|UploadIntentDTO,now:Date){return scope.insertReceipt({id:receiptId,commandId,commandType:command.type,payloadHash:command.hash,response:data,createdAt:now});}
 /** Authentication changes take precedence; token/CAS or store compensation failure never masks original work error. */
 async compensate(claim:UploadRecord,error:unknown,mode:'process'|'complete'):Promise<never>{
  try{await this.revalidate();}catch(validation){if(['OWNER_UNAVAILABLE','DATASET_CHANGED','UNAUTHORIZED','FORBIDDEN','LOCAL_SESSION_INVALID','LOCAL_HOST_INVALID'].includes(code(validation)))throw validation;throw error;}
  try{await this.write(async(scope,now)=>{const row=await this.upload(scope,claim.id);if(row.processingToken!==claim.processingToken||row.status!==claim.status||row.revision!==claim.revision||!this.active(row,now))return;
   const status=corrupt(error)?'failed':mode==='process'&&row.outputSha256===null?'reserved':row.status;
   await this.change(scope,row,{status,processingToken:null,leaseExpiresAt:null,updatedAt:now});
  });}catch(compensation){if(['OWNER_UNAVAILABLE','DATASET_CHANGED','UNAUTHORIZED','FORBIDDEN','LOCAL_SESSION_INVALID','LOCAL_HOST_INVALID'].includes(code(compensation)))throw compensation;}
  throw error;
 }
}
