import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {access,copyFile,rename,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {v7} from 'uuid';
import * as host from '../src/host/index.js';
import * as stores from '../src/infrastructure/db/prisma-asset-maintenance-store.js';
import {prepare,dispose,fixture,type Fixture} from './fixtures/host-assets/setup.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{vi.restoreAllMocks();await f.close();});
function run(input:Record<string,unknown>={}){expect(host).toHaveProperty('maintainLocalAssets');return host.maintainLocalAssets(f.directory,'dev',f.token,{datasetId:f.manifest.datasetId,...input});}
const noFiles=()=>expect(access(f.assetsPath)).rejects.toMatchObject({code:'ENOENT'});
async function reserve(){return host.withLocalAssets(f.directory,'dev',f.token,async s=>(await s.begin(f.input())).data);}
async function fail(id:string){await f.database(db=>db.assetUpload.update({where:{id},data:{status:'failed'}}));}
it('empty apply and populated preview do not create assets directory or mutate the write epoch',async()=>{
 const before=await f.database(db=>db.localProfile.findUniqueOrThrow({where:{id:f.manifest.ownerId}}));
 expect(await run({apply:true})).toMatchObject({examined:0,nextCursor:null});await noFiles();
 const upload=await reserve();await fail(upload.id);const epoch=await f.database(db=>db.localProfile.findUniqueOrThrow({where:{id:f.manifest.ownerId}}));
 expect(await run()).toMatchObject({mode:'preview',examined:1,items:[{uploadId:upload.id,outcome:'preview'}]});await noFiles();
 expect((await f.database(db=>db.localProfile.findUniqueOrThrow({where:{id:f.manifest.ownerId}}))).writeEpoch).toBe(epoch.writeEpoch);
 expect(epoch.writeEpoch).toBeGreaterThan(before.writeEpoch);
});
it('actual apply deletes only failed candidate; disconnect/restart retry is absent and keeps deleting',async()=>{
 const upload=await reserve();await host.withLocalAssets(f.directory,'dev',f.token,s=>s.process(f.query(upload.id),{openBody:()=>new ReadableStream({start(c){c.enqueue(f.bytes);c.close();}})}));await fail(upload.id);
 const report=await run({apply:true});expect(report.items).toEqual([{uploadId:upload.id,outcome:'removed'}]);
 await expect(access(f.candidate(upload.assetId))).rejects.toMatchObject({code:'ENOENT'});
 const newSession=await f.reconnect();const again=await host.maintainLocalAssets(f.directory,'dev',newSession.token,{datasetId:f.manifest.datasetId,apply:true});expect(again.items).toEqual([{uploadId:upload.id,outcome:'absent'}]);
 expect((await f.database(db=>db.assetUpload.findUniqueOrThrow({where:{id:upload.id}}))).status).toBe('deleting');
});
it('dataset and revoked session fail before candidate enumeration, no assets directory',async()=>{
 const list=vi.spyOn(stores.PrismaAssetMaintenanceStore.prototype,'list');await expect(run({datasetId:v7()})).rejects.toThrow('DATASET_CHANGED');expect(list).not.toHaveBeenCalled();
 await host.revokeSession(f.directory,'dev',f.token);await expect(run({apply:true})).rejects.toThrow('LOCAL_SESSION_INVALID');expect(list).not.toHaveBeenCalled();await noFiles();
});
it('lease candidate consumes the page and cursor moves beyond it',async()=>{
 const a=await reserve(),b=await reserve();await fail(a.id);await fail(b.id);
 await f.database(db=>db.assetUpload.update({where:{id:a.id},data:{leaseExpiresAt:new Date(Date.now()+60000)}}));
 const first=await run({apply:true,limit:1});expect(first.items).toEqual([{uploadId:a.id,outcome:'lease-protected'}]);await noFiles();
 const second=await run({apply:true,limit:1,cursor:first.nextCursor!});expect(second.items).toEqual([{uploadId:b.id,outcome:'absent'}]);
});
it.each(['session','dataset','inode'])('real %s replacement after enumeration rejects old binding before T1/files',async kind=>{
 const upload=await reserve();await fail(upload.id);const original=stores.PrismaAssetMaintenanceStore.prototype.list;
 vi.spyOn(stores.PrismaAssetMaintenanceStore.prototype,'list').mockImplementationOnce(async function(this:stores.PrismaAssetMaintenanceStore,...args){
  const result=await original.apply(this,args);
  if(kind==='session')await host.revokeSession(f.directory,'dev',f.token);
  else if(kind==='dataset'){
   const path=join(f.directory,'manifest.json');const manifest=JSON.parse(await readFile(path,'utf8'));manifest.datasetId=v7();await writeFile(path,JSON.stringify(manifest));
  }else{const path=join(f.directory,'runtime.db');await copyFile(path,join(f.directory,'copy.db'));await rename(path,join(f.directory,'old.db'));await rename(join(f.directory,'copy.db'),path);}
  return result;
 });
 await expect(run({apply:true})).rejects.toThrow(kind==='session'?'LOCAL_SESSION_INVALID':kind==='dataset'?'DATASET_CHANGED':'LOCAL_ASSET_MAINTENANCE_FAILED');await noFiles();
});
it('complete winning after enumeration is protected by real cleanup T1',async()=>{
 const upload=await reserve();await host.withLocalAssets(f.directory,'dev',f.token,s=>s.process(f.query(upload.id),{openBody:()=>new ReadableStream({start(c){c.enqueue(f.bytes);c.close();}})}));
 vi.spyOn(stores.PrismaAssetMaintenanceStore.prototype,'list').mockImplementationOnce(async()=>{
  // Real completed state after the enumerator's stale candidate hint.
  await host.withLocalAssets(f.directory,'dev',f.token,s=>s.complete(f.complete(upload.id)));
  return [{id:upload.id,createdAt:new Date(upload.createdAt),status:'published',leaseExpiresAt:null}];
 });
 expect((await run({apply:true})).items).toEqual([{uploadId:upload.id,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'}]);await access(f.candidate(upload.assetId));
 expect((await f.database(db=>db.asset.findUniqueOrThrow({where:{id:upload.assetId}}))).status).toBe('ready');
});
it.each(['ready','unavailable','soft-deleted','path-alias','duplicate-intent'])('maintenance preserves %s identity and advances past the error',async kind=>{
 const a=await reserve(),b=await reserve();await fail(a.id);await fail(b.id);
 await f.database(async db=>{
  if(kind==='duplicate-intent'){
   const r=await db.assetUpload.findUniqueOrThrow({where:{id:a.id}});await db.assetUpload.create({data:{...r,id:v7(),ownerId:v7()}});
  }else await db.asset.create({data:{id:kind==='path-alias'?v7():a.assetId,ownerId:f.manifest.ownerId,storageKey:`assets/${f.manifest.datasetId}/${a.assetId}.webp`,sha256:'a'.repeat(64),mimeType:'image/webp',byteSize:10n,width:256,height:256,originalName:'private',rightsDeclaration:'private',status:kind==='unavailable'?'unavailable':'ready',deletedAt:kind==='soft-deleted'?new Date():null,createdAt:new Date(),updatedAt:new Date()}});
 });
 const first=await run({apply:true,limit:1});expect(first.items).toEqual([{uploadId:a.id,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'}]);await noFiles();
 expect(first.nextCursor).toBeTypeOf('string');const second=await run({apply:true,limit:1,cursor:first.nextCursor!});expect(second.items).toEqual([{uploadId:b.id,outcome:'absent'}]);
 expect((await f.database(db=>db.assetUpload.findUniqueOrThrow({where:{id:a.id}}))).status).toBe('failed');
});
it('actual DB default quota 25 / hard 100; no fetch-until-empty and next cursor remains scoped',async()=>{
 const base=await reserve();await f.database(async db=>{
  const r=await db.assetUpload.findUniqueOrThrow({where:{id:base.id}});await db.assetUpload.delete({where:{id:r.id}});
  await db.assetUpload.createMany({data:Array.from({length:102},()=>({...r,id:v7(),assetId:v7(),status:'failed'}))});
 });
 const list=vi.spyOn(stores.PrismaAssetMaintenanceStore.prototype,'list');const a=await run();expect(a.examined).toBe(25);expect(list).toHaveBeenCalledOnce();
 const b=await run({limit:100});expect(b.examined).toBe(100);expect(list).toHaveBeenCalledTimes(2);
 const c=await run({limit:100,cursor:b.nextCursor!});expect(c.examined).toBe(2);expect(c.nextCursor).toBeNull();await noFiles();
// 127 real host-bound item checks compete with the full integration suite for disk I/O.
},15000);
