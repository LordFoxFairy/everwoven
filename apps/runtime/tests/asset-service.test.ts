import {beforeAll,afterAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {v7} from 'uuid';
import {prepare,dispose,fixture,type Fixture} from './fixtures/asset-service/setup.js';
import {parseUploadIntentDTO,parseAssetDTO} from '../src/contracts/asset-validation.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{vi.restoreAllMocks();await f?.close();});
it('begin commits canonical reserved + receipt; lost response replay stays historical while get reads current state',async()=>{
 const input=f.begin(),a=await f.service.begin(input);expect(a.replayed).toBe(false);expect(parseUploadIntentDTO(a.data)).toEqual(a.data);expect(a.data.status).toBe('reserved');expect(Date.parse(a.data.expiresAt)-Date.parse(a.data.createdAt)).toBe(86400000);expect(f.deps.openFiles).not.toHaveBeenCalled();expect(f.source.openBody).not.toHaveBeenCalled();
 await f.service.process(f.query(a.data.id),f.source);const replay=await f.service.begin(input);expect(replay).toEqual({...a,replayed:true});expect((await f.service.getUpload(f.query(a.data.id))).status).toBe('published');expect(await f.db.assetUpload.count()).toBe(1);await expect(f.service.begin({...input,originalName:'other.png'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('process/complete/getBytes form a real SQLite and FileStore lifecycle, with complete receipt replay and new completed command',async()=>{
 const upload=(await f.service.begin(f.begin())).data;const published=await f.service.process(f.query(upload.id),f.source);expect(published.status).toBe('published');const command=f.complete(upload.id),done=await f.service.complete(command);expect(parseAssetDTO(done.data)).toEqual(done.data);expect(done.data.status).toBe('ready');expect(await f.service.complete(command)).toEqual({...done,replayed:true});expect((await f.service.complete(f.complete(upload.id))).data).toEqual(done.data);const actual=await f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId});expect(actual.bytes).toEqual(await readFile(f.candidate(upload.assetId)));expect(actual.data).toEqual(done.data);expect(await f.db.asset.count()).toBe(1);expect(await f.db.commandReceipt.count()).toBe(3);
});
it.each(['dataset','invalid','auth','foreign','deleted-owner'])('rejects %s before body/files side effects',async kind=>{
 const upload=(await f.service.begin(f.begin())).data;vi.mocked(f.deps.openFiles).mockClear();let query=f.query(upload.id);
 if(kind==='dataset')query={...query,datasetId:v7()};if(kind==='invalid')query={...query,uploadId:'../invalid'};if(kind==='auth')vi.mocked(f.deps.revalidate).mockRejectedValue(Error('UNAUTHORIZED'));if(kind==='foreign')await f.db.assetUpload.update({where:{id:upload.id},data:{ownerId:v7()}});if(kind==='deleted-owner')await f.db.localProfile.update({where:{id:f.owner.ownerId},data:{deletedAt:new Date()}});
 await expect(f.service.process(query,f.source)).rejects.toBeTruthy();expect(f.source.openBody).not.toHaveBeenCalled();expect(f.deps.openFiles).not.toHaveBeenCalled();
});
it('invalid begin metadata and cross-dataset commands do not create receipts',async()=>{await expect(f.service.begin({...f.begin(),originalName:'../private'})).rejects.toThrow('INVALID_ASSET_COMMAND');await expect(f.service.begin({...f.begin(),datasetId:v7()})).rejects.toThrow('DATASET_CHANGED');expect(await f.db.commandReceipt.count()).toBe(0);expect(await f.db.assetUpload.count()).toBe(0);});
it('receiver or decoder failure before output restores reserved without leaking tokens in DTO',async()=>{
 const upload=(await f.service.begin(f.begin())).data;vi.spyOn(f.deps.normalizer,'normalize').mockRejectedValue(Error('INVALID_IMAGE_DATA'));await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('INVALID_IMAGE_DATA');expect((await f.service.getUpload(f.query(upload.id))).status).toBe('reserved');const row=await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}});expect(row.processingToken).toBeNull();expect(row.leaseExpiresAt).toBeNull();expect(f.deps.openFiles).not.toHaveBeenCalled();
});
it('old failed worker cannot compensate over a newer processing token',async()=>{
 const upload=(await f.service.begin(f.begin())).data;vi.spyOn(f.deps.normalizer,'normalize').mockImplementation(async()=>{await f.db.assetUpload.update({where:{id:upload.id},data:{processingToken:v7(),revision:{increment:1}}});throw Error('INVALID_IMAGE_DATA');});await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('INVALID_IMAGE_DATA');expect((await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}})).status).toBe('processing');
});
it('complete can recover durable bytes whose published transaction never committed, after processing lease expiry',async()=>{
 const upload=(await f.service.begin(f.begin())).data;const write=f.files.writeCandidate.bind(f.files);vi.spyOn(f.files,'writeCandidate').mockImplementation(async(...args)=>{await write(...args);throw Error('PRIVATE_ASSET_IO');});await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('PRIVATE_ASSET_IO');f.advance(120001);const done=await f.service.complete(f.complete(upload.id));expect(done.data.status).toBe('ready');expect(await f.db.asset.count()).toBe(1);
});
it.each(['partial','absent'])('does not fabricate ready for %s candidates; complete/reupload recovery remains explicit',async kind=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await rm(f.candidate(upload.assetId));if(kind==='partial')await writeFile(f.candidate(upload.assetId),'partial',{mode:0o600});await expect(f.service.complete(f.complete(upload.id))).rejects.toBeTruthy();expect(await f.db.asset.count()).toBe(0);
 const current=await f.service.getUpload(f.query(upload.id));expect(current.status).toBe(kind==='partial'?'failed':'finalizing');if(kind==='absent'){await f.service.process(f.query(upload.id),f.source);expect((await f.service.complete(f.complete(upload.id))).data.status).toBe('ready');}else {expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'removed'});expect((await f.service.getUpload(f.query(upload.id))).status).toBe('deleting');}
});
it('expired processing takeover preserves and checks pre-stored normalized output',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await f.db.assetUpload.update({where:{id:upload.id},data:{outputSha256:'f'.repeat(64)}});await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('ASSET_OUTPUT_MISMATCH');expect(await f.db.asset.count()).toBe(0);
});
it('cleanup refuses unexpired recoverable tasks and completed assets, but retains terminal rows for late writers',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await expect(f.service.cleanup(f.query(upload.id))).rejects.toThrow('ASSET_CLEANUP_NOT_ALLOWED');f.advance(86400001);expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'absent'});await writeFile(f.candidate(upload.assetId),'late',{mode:0o600});expect(await f.service.cleanup(f.query(upload.id))).toEqual({kind:'removed'});expect(await f.db.assetUpload.count()).toBe(1);
});
it('missing ready bytes become unavailable, whereas transient decoder/IO failure leaves ready unchanged',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);await f.service.complete(f.complete(upload.id));const spy=vi.spyOn(f.files,'verifyCandidate').mockRejectedValueOnce(Error('IMAGE_DECODER_BUSY'));await expect(f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId})).rejects.toThrow('IMAGE_DECODER_BUSY');expect((await f.db.asset.findUniqueOrThrow({where:{id:upload.assetId}})).status).toBe('ready');spy.mockRestore();await rm(f.candidate(upload.assetId));await expect(f.service.getBytes({datasetId:f.owner.datasetId,assetId:upload.assetId})).rejects.toBeTruthy();expect((await f.db.asset.findUniqueOrThrow({where:{id:upload.assetId}})).status).toBe('unavailable');
});
