import {beforeAll,afterAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose,fixture,type Fixture} from './fixtures/asset-service/setup.js';
import {PrismaAssetStore} from '../src/infrastructure/db/prisma-asset-store.js';
import {createAssets} from '../src/application/assets.js';
import type {AssetWriteScope} from '../src/ports/asset-store.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{vi.restoreAllMocks();await f?.close();});
function instrument(replace:(scope:AssetWriteScope)=>AssetWriteScope){const backing=new PrismaAssetStore(f.db);return createAssets({read:backing.read.bind(backing),write:(owner,work)=>backing.write(owner,scope=>work(replace(scope)))},f.deps);}
it('begin receipt failure rolls back intent, receipt and WriteGate in actual SQLite',async()=>{
 const service=instrument(scope=>({...scope,insertReceipt:async value=>{await scope.insertReceipt(value);throw Error('/private injected SQL fault');}}));await expect(service.begin(f.begin())).rejects.toThrow('ASSET_OPERATION_FAILED');expect(await f.db.assetUpload.count()).toBe(0);expect(await f.db.commandReceipt.count()).toBe(0);expect((await f.db.localProfile.findUniqueOrThrow({where:{id:f.owner.ownerId}})).writeEpoch).toBe(0);
});
it.each(['output','published'])('transaction failure after %s CAS rolls back only that transaction; compensation remains schema-valid',async phase=>{
 let fail=true;const service=instrument(scope=>({...scope,casUpload:async(row,patch)=>{const count=await scope.casUpload(row,patch);if(fail&&(phase==='output'?patch.outputSha256!==undefined:patch.status==='published')){fail=false;throw Error('injected transaction fault');}return count;}}));const upload=(await service.begin(f.begin())).data;await expect(service.process(f.query(upload.id),f.source)).rejects.toThrow('ASSET_OPERATION_FAILED');const current=await service.getUpload(f.query(upload.id));expect(current.status).toBe(phase==='output'?'reserved':'processing');expect(current.outputSha256===null).toBe(phase==='output');if(phase==='output')await service.process(f.query(upload.id),f.source);expect((await service.complete(f.complete(upload.id))).data.status).toBe('ready');
});
it('complete Asset+completed+receipt roll back atomically on receipt failure; same command then creates exactly one Asset',async()=>{
 let fail=false;const service=instrument(scope=>({...scope,insertReceipt:async value=>{await scope.insertReceipt(value);if(fail&&value.commandType==='authoring.asset.complete.v1')throw Error('injected receipt failure');}}));const upload=(await service.begin(f.begin())).data;await service.process(f.query(upload.id),f.source);fail=true;const command=f.complete(upload.id);await expect(service.complete(command)).rejects.toThrow('ASSET_OPERATION_FAILED');expect(await f.db.asset.count()).toBe(0);expect(await f.db.commandReceipt.count()).toBe(1);expect((await service.getUpload(f.query(upload.id))).status).toBe('finalizing');fail=false;expect((await service.complete(command)).data.status).toBe('ready');expect(await f.db.asset.count()).toBe(1);expect(await f.db.commandReceipt.count()).toBe(2);
});
it('Clock and IdFactory are consumed only from inside the acquired real WriteGate callback, never at factory construction',async()=>{
 let acquired=false;const clock=vi.fn(()=>{expect(acquired).toBe(true);return new Date('2026-09-12T00:00:00.000Z');}),ids=vi.fn(()=>{expect(acquired).toBe(true);return v7();}),base=new PrismaAssetStore(f.db);const service=createAssets({read:base.read.bind(base),write:(owner,work)=>base.write(owner,async scope=>{acquired=true;try{return await work(scope);}finally{acquired=false;}})},{...f.deps,services:{clock:{now:clock},ids:{next:ids}}});expect(clock).not.toHaveBeenCalled();expect(ids).not.toHaveBeenCalled();expect(f.deps.openFiles).not.toHaveBeenCalled();await service.begin(f.begin());expect(clock).toHaveBeenCalledTimes(1);expect(ids).toHaveBeenCalledTimes(2);
});
it.each(['duplicate-upload','asset-shadow','invalid-dto','revision-overflow'])('%s rejects processing before body and private files',async kind=>{
 const upload=(await f.service.begin(f.begin())).data;
 if(kind==='duplicate-upload'){const row=await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}});await f.db.assetUpload.create({data:{...row,id:v7(),ownerId:v7()}});}
 else if(kind==='asset-shadow')await f.db.asset.create({data:{id:v7(),ownerId:v7(),storageKey:`assets/${f.owner.datasetId}/${upload.assetId}.webp`,sha256:'a'.repeat(64),mimeType:'image/webp',byteSize:1n,originalName:'other',width:1,height:1,rightsDeclaration:'fixture',status:'unavailable',createdAt:new Date(),updatedAt:new Date()}});
 else if(kind==='invalid-dto')await f.db.assetUpload.update({where:{id:upload.id},data:{outputWidth:123}});
 else await f.db.assetUpload.update({where:{id:upload.id},data:{revision:2147483647}});
 await expect(f.service.process(f.query(upload.id),f.source)).rejects.toBeTruthy();expect(f.source.openBody).not.toHaveBeenCalled();expect(f.deps.openFiles).not.toHaveBeenCalled();
});
it('malformed stored receipt fails strictly and does not duplicate an upload',async()=>{
 const input=f.begin();await f.service.begin(input);await f.db.commandReceipt.updateMany({data:{response:{extra:'private'}}});await expect(f.service.begin(input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');expect(await f.db.assetUpload.count()).toBe(1);
});
