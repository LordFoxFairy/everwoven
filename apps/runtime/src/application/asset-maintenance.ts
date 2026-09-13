import {isBusinessId,isTimestamp} from '../contracts/primitives.js';
import {parseOwner} from '../contracts/story-draft-validation.js';
import type {AssetMaintenanceStore,AssetMaintenanceDependencies,AssetMaintenanceInput,AssetMaintenanceResult,MaintenancePosition} from '../ports/asset-maintenance.js';

// A bounded SQLite TEXT position is not a business identity or cleanup authority.
// Preserve exact Unicode (no normalization), reject ill-formed/control text, and
// cap UTF-8 bytes so even JSON-escaped IDs fit the existing 1024-character cursor.
function isPositionId(value:unknown):value is string{
 return typeof value==='string'&&value.length<=128&&Buffer.byteLength(value,'utf8')<=128&&
  Buffer.from(value,'utf8').toString('utf8')===value&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
}
const isPositionTime=(value:unknown):value is string=>typeof value==='string'&&value.length===24&&isTimestamp(value);

export function parseAssetMaintenanceInput(input:AssetMaintenanceInput){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['datasetId','apply','limit','cursor'].includes(k))||
  !isBusinessId(input.datasetId)||(input.apply!==undefined&&typeof input.apply!=='boolean')||
  (input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>100)))throw Error('INVALID_ASSET_MAINTENANCE');
 if(input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length===0||input.cursor.length>1024))throw Error('INVALID_ASSET_MAINTENANCE_CURSOR');
 return {datasetId:input.datasetId,apply:input.apply??false,limit:input.limit??25,cursor:input.cursor};
}
function position(cursor:string|undefined,owner:{ownerId:string;datasetId:string}):MaintenancePosition|null{
 if(cursor===undefined)return null;
 try{
  if(!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();
  const bytes=Buffer.from(cursor,'base64url');if(bytes.toString('base64url')!==cursor)throw Error();
  const value=JSON.parse(bytes.toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,datasetId,id,ownerId'||
   value.datasetId!==owner.datasetId||value.ownerId!==owner.ownerId||!isPositionId(value.id)||!isPositionTime(value.createdAt))throw Error();
  return {id:value.id,createdAt:new Date(value.createdAt)};
 }catch{throw Error('INVALID_ASSET_MAINTENANCE_CURSOR');}
}
const fatal=new Set(['LOCAL_SESSION_INVALID','LOCAL_HOST_INVALID','DATASET_CHANGED','OWNER_UNAVAILABLE','UNAUTHORIZED','FORBIDDEN']);
/** One bounded page, not a worker. Enumeration is only a hint: existing cleanup owns T1/T2.
 * Cursor is a scoped position, not authorization or a snapshot of eligibility. Start a new
 * pass without a cursor to revisit deleting records/late publishers or expired leases. */
export function createAssetMaintenance(store:AssetMaintenanceStore,deps:AssetMaintenanceDependencies){
 parseOwner(deps.owner);const owner=Object.freeze({...deps.owner});
 return async(input:AssetMaintenanceInput):Promise<AssetMaintenanceResult>=>{
  const value=parseAssetMaintenanceInput(input);
  if(value.datasetId!==owner.datasetId)throw Error('DATASET_CHANGED');
  const after=position(value.cursor,owner);
  await deps.revalidate();const now=deps.now?.()??new Date();
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('ASSET_MAINTENANCE_FAILED');
  const rows=await store.list(owner.ownerId,{now,after,limit:value.limit});await deps.revalidate();
  if(rows.length>value.limit)throw Error('ASSET_MAINTENANCE_FAILED');
  const result:AssetMaintenanceResult={datasetId:owner.datasetId,mode:value.apply?'apply':'preview',examined:0,items:[],nextCursor:null};
  let previous=after;
  for(const row of rows){
   // Unusable/out-of-domain pagination keys fail the page closed. Do not issue a
   // lossy cursor or promise recovery of arbitrary persistent corruption.
   if(!isPositionId(row.id)||!(row.createdAt instanceof Date)||!Number.isFinite(row.createdAt.getTime())||!isPositionTime(row.createdAt.toISOString())||
    (previous&&(row.createdAt<previous.createdAt||(row.createdAt.getTime()===previous.createdAt.getTime()&&Buffer.compare(Buffer.from(row.id),Buffer.from(previous.id))<=0))))throw Error('ASSET_MAINTENANCE_FAILED');
   await deps.revalidate();result.examined++;previous=row;
   if(!isBusinessId(row.id))result.items.push({uploadId:row.id,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'});
   else if(row.leaseExpiresAt!==null&&row.leaseExpiresAt.getTime()>now.getTime())result.items.push({uploadId:row.id,outcome:'lease-protected'});
   else if(!value.apply)result.items.push({uploadId:row.id,outcome:'preview'});
   else{
    try{const removed=await deps.cleanup({datasetId:owner.datasetId,uploadId:row.id});result.items.push({uploadId:row.id,outcome:removed.kind});}
    catch(error){if(error instanceof Error&&fatal.has(error.message))throw error;result.items.push({uploadId:row.id,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'});}
   }
   // Even after a caught per-row error, a changed Host/session stops this page.
   await deps.revalidate();
  }
  if(rows.length===value.limit&&previous)result.nextCursor=Buffer.from(JSON.stringify({...owner,id:previous.id,createdAt:previous.createdAt.toISOString()})).toString('base64url');
  return result;
 };
}
