import {beforeAll,afterAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {readFile,rm} from 'node:fs/promises';
import {v7} from 'uuid';
import {prepare,dispose,fixture,type Fixture} from './fixtures/asset-service/setup.js';
import {createCharacterService} from '../src/composition/character-service.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{vi.restoreAllMocks();await f?.close();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
it('two concurrent same-command completes create one Asset/receipt; the busy caller explicitly retries the original command',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);const command=f.complete(upload.id),entered=deferred(),release=deferred(),verify=f.files.ensureDurableCandidate.bind(f.files);vi.spyOn(f.files,'ensureDurableCandidate').mockImplementation(async(...args)=>{const result=await verify(...args);entered.resolve();await release.promise;return result;});const first=f.service.complete(command).catch(e=>e);
 try{await entered.promise;await expect(f.service.complete(command)).rejects.toThrow('ASSET_UPLOAD_BUSY');release.resolve();const result=await first;expect(result.data.status).toBe('ready');expect(await f.service.complete(command)).toEqual({...result,replayed:true});expect(await f.db.asset.count()).toBe(1);expect(await f.db.commandReceipt.count()).toBe(2);}finally{release.resolve();await first;}
});
it('cleanup wins after verification when the finalizer expires: stale completion writes no ready Asset or receipt',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);const ensure=f.files.ensureDurableCandidate.bind(f.files);vi.spyOn(f.files,'ensureDurableCandidate').mockImplementation(async(...args)=>{const evidence=await ensure(...args);f.advance(86400001);expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'removed'});return evidence;});await expect(f.service.complete(f.complete(upload.id))).rejects.toThrow('ASSET_LEASE_LOST');expect(await f.db.asset.count()).toBe(0);expect(await f.db.commandReceipt.count()).toBe(1);expect((await f.service.getUpload(f.query(upload.id))).status).toBe('deleting');
});
it('complete committed first prevents cleanup even after upload expiry',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await f.service.complete(f.complete(upload.id));f.advance(86400001);const remove=vi.spyOn(f.files,'removeDeletingCandidate');await expect(f.service.cleanup(f.query(upload.id))).rejects.toThrow('ASSET_CLEANUP_NOT_ALLOWED');expect(remove).not.toHaveBeenCalled();expect((await readFile(f.candidate(upload.assetId))).length).toBeGreaterThan(0);
});
it('a stale successful processing worker cannot pre-store output or publish over its real successor',async()=>{
 const upload=(await f.service.begin(f.begin())).data,entered=deferred(),release=deferred(),normalize=f.deps.normalizer.normalize.bind(f.deps.normalizer);let first=true;vi.spyOn(f.deps.normalizer,'normalize').mockImplementation(async(...args)=>{if(first){first=false;entered.resolve();await release.promise;}return normalize(...args);});const old=f.service.process(f.query(upload.id),f.source).catch(e=>e);
 try{await entered.promise;f.advance(120001);const current=await f.service.process(f.query(upload.id),f.source);expect(current.status).toBe('published');release.resolve();expect((await old).message).toBe('ASSET_LEASE_LOST');expect(await f.service.getUpload(f.query(upload.id))).toEqual(current);}finally{release.resolve();await old;}
});
it('late writer after deleting leaves only a reclaimable candidate, never resurrecting published or ready',async()=>{
 const upload=(await f.service.begin(f.begin())).data,entered=deferred(),release=deferred(),write=f.files.writeCandidate.bind(f.files);vi.spyOn(f.files,'writeCandidate').mockImplementation(async(...args)=>{entered.resolve();await release.promise;return write(...args);});const old=f.service.process(f.query(upload.id),f.source).catch(e=>e);
 try{await entered.promise;f.advance(86400001);expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'absent'});release.resolve();expect((await old).message).toBe('ASSET_LEASE_LOST');expect((await readFile(f.candidate(upload.assetId))).length).toBeGreaterThan(0);expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'removed'});expect(await f.db.asset.count()).toBe(0);expect((await f.service.getUpload(f.query(upload.id))).status).toBe('deleting');}finally{release.resolve();await old;}
});
it('T1 is already committed when openFiles or T2 fails; repeated deleting remains eligible',async()=>{
 const upload=(await f.service.begin(f.begin())).data;f.advance(86400001);vi.mocked(f.deps.openFiles).mockRejectedValueOnce(Error('PRIVATE_ASSET_IO'));await expect(f.service.cleanup(f.query(upload.id))).rejects.toThrow('PRIVATE_ASSET_IO');expect((await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}})).status).toBe('deleting');expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'absent'});
});
it.each(['IMAGE_DECODER_BUSY','IMAGE_PROCESSING_TIMEOUT','PRIVATE_ASSET_IO'])('getBytes %s does not permanently degrade a ready Asset',async error=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await f.service.complete(f.complete(upload.id));vi.spyOn(f.files,'verifyCandidate').mockRejectedValue(Error(error));await expect(f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId})).rejects.toThrow(error);expect((await f.db.asset.findUniqueOrThrow({where:{id:upload.assetId}})).status).toBe('ready');
});
it('missing ready file becomes unavailable and the real character service rejects a new portrait reference',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await f.service.complete(f.complete(upload.id));await rm(f.candidate(upload.assetId));await expect(f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId})).rejects.toThrow('PRIVATE_ASSET_NOT_FOUND');await expect(createCharacterService(f.db).create(f.owner,{datasetId:f.owner.datasetId,commandId:v7(),name:'new',settings:{personality:'',appearance:'',speakingStyle:'',boundaries:''},portraitAssetId:upload.assetId})).rejects.toThrow('INVALID_CHARACTER_PORTRAIT');
});
it('a late getBytes result cannot bypass changed Asset revision/status and returns the same verified Buffer otherwise',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await f.service.complete(f.complete(upload.id));const verify=f.files.verifyCandidate.bind(f.files);let captured:Buffer|undefined;const spy=vi.spyOn(f.files,'verifyCandidate').mockImplementation(async(...args)=>{const result=await verify(...args);captured=result.bytes;return result;});expect((await f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId})).bytes).toBe(captured);spy.mockImplementation(async(...args)=>{const result=await verify(...args);await f.db.asset.update({where:{id:upload.assetId},data:{deletedAt:new Date(),revision:{increment:1}}});return result;});await expect(f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId})).rejects.toThrow('ASSET_UNAVAILABLE');
});
it('real receiver capacity failure restores only its own reserved intent and never opens the third body',async()=>{
 const uploads=await Promise.all([f.service.begin(f.begin()),f.service.begin(f.begin()),f.service.begin(f.begin())]),entered=deferred(),release=deferred(),normalize=f.deps.normalizer.normalize.bind(f.deps.normalizer);let calls=0;vi.spyOn(f.deps.normalizer,'normalize').mockImplementation(async(...args)=>{if(++calls===2)entered.resolve();await release.promise;return normalize(...args);});const first=f.service.process(f.query(uploads[0]!.data.id),f.source).catch(e=>e),second=f.service.process(f.query(uploads[1]!.data.id),f.source).catch(e=>e);const thirdBody={openBody:vi.fn(()=>null)};
 try{await entered.promise;await expect(f.service.process(f.query(uploads[2]!.data.id),thirdBody)).rejects.toThrow('IMAGE_BODY_BUSY');expect(thirdBody.openBody).not.toHaveBeenCalled();expect((await f.service.getUpload(f.query(uploads[2]!.data.id))).status).toBe('reserved');}finally{release.resolve();expect((await first).status).toBe('published');expect((await second).status).toBe('published');}
});
it.each(['abort','hash'])('real receiver %s rejection restores reserved without starting decoder/files',async kind=>{
 const input=f.begin();if(kind==='hash')input.inputSha256='f'.repeat(64);
 const upload=(await f.service.begin(input)).data,controller=new AbortController();if(kind==='abort')controller.abort();
 const normalize=vi.spyOn(f.deps.normalizer,'normalize');
 await expect(f.service.process(f.query(upload.id),{...f.source,signal:controller.signal})).rejects.toThrow(kind==='abort'?'IMAGE_BODY_ABORTED':'IMAGE_BODY_HASH_MISMATCH');
 expect(normalize).not.toHaveBeenCalled();expect(f.deps.openFiles).not.toHaveBeenCalled();
 const row=await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}});expect(row.status).toBe('reserved');expect(row.processingToken).toBeNull();expect(row.leaseExpiresAt).toBeNull();expect(row.outputSha256).toBeNull();
});
it('ensureDurable failure never creates ready; it releases only the finalizing lease for explicit retry',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);const command=f.complete(upload.id);
 vi.spyOn(f.files,'ensureDurableCandidate').mockRejectedValueOnce(Error('PRIVATE_ASSET_IO'));
 await expect(f.service.complete(command)).rejects.toThrow('PRIVATE_ASSET_IO');
 const row=await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}});expect(row.status).toBe('finalizing');expect(row.processingToken).toBeNull();expect(row.leaseExpiresAt).toBeNull();expect(row.outputSha256).not.toBeNull();expect(await f.db.asset.count()).toBe(0);expect(await f.db.commandReceipt.count()).toBe(1);
 expect((await f.service.complete(command)).data.status).toBe('ready');expect(await f.db.commandReceipt.count()).toBe(2);
});
it('cross-dataset durable evidence is rejected before published or ready can be committed',async()=>{
 const upload=(await f.service.begin(f.begin())).data,write=f.files.writeCandidate.bind(f.files);
 vi.spyOn(f.files,'writeCandidate').mockImplementation(async(...args)=>({...await write(...args),datasetId:v7()}));
 await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('ASSET_EVIDENCE_INVALID');expect((await f.service.getUpload(f.query(upload.id))).status).toBe('processing');
 const ensure=f.files.ensureDurableCandidate.bind(f.files);vi.spyOn(f.files,'ensureDurableCandidate').mockImplementation(async(...args)=>({...await ensure(...args),datasetId:v7()}));
 await expect(f.service.complete(f.complete(upload.id))).rejects.toThrow('ASSET_EVIDENCE_INVALID');expect(await f.db.asset.count()).toBe(0);expect(await f.db.commandReceipt.count()).toBe(1);
});
