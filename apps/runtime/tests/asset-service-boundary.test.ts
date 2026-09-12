import {beforeAll,afterAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose,fixture,type Fixture} from './fixtures/asset-service/setup.js';
import {sanitize} from '../src/application/assets-support.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{vi.restoreAllMocks();await f?.close();});
it.each(['PRIVATE_ASSET_PRIVATE_SQL','IMAGE_PRIVATE_BODY','ASSET_BODY_TOKEN_SECRET','PRIVATE_ASSET_IO /secret'])('never echoes arbitrary prefix-shaped errors: %s',message=>{const result=sanitize(Error(message));expect(result.message).toBe('ASSET_OPERATION_FAILED');expect(result.cause).toBeUndefined();});
it.each(['LOCAL_SESSION_INVALID','LOCAL_HOST_INVALID','DATASET_CHANGED'])('preserves exact revalidation error %s without touching body or files',async message=>{const upload=(await f.service.begin(f.begin())).data;vi.mocked(f.deps.revalidate).mockRejectedValue(Error(message));await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow(message);expect(f.source.openBody).not.toHaveBeenCalled();expect(f.deps.openFiles).not.toHaveBeenCalled();});
it('session loss during failure compensation supersedes the work error instead of disappearing into 500',async()=>{
 const upload=(await f.service.begin(f.begin())).data;vi.spyOn(f.deps.normalizer,'normalize').mockImplementation(async()=>{vi.mocked(f.deps.revalidate).mockRejectedValue(Error('LOCAL_SESSION_INVALID'));throw Error('INVALID_IMAGE_DATA');});await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('LOCAL_SESSION_INVALID');expect((await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}})).status).toBe('processing');
});
it('dataset mismatch precedes receipt lookup, including an existing valid command',async()=>{const input=f.begin();await f.service.begin(input);const tx=vi.spyOn(f.db,'$transaction');await expect(f.service.begin({...input,datasetId:v7()})).rejects.toThrow('DATASET_CHANGED');expect(tx).not.toHaveBeenCalled();});
it('unknown compensation revalidation failure stops compensation without replacing the original work error',async()=>{
 const upload=(await f.service.begin(f.begin())).data;vi.spyOn(f.deps.normalizer,'normalize').mockImplementation(async()=>{vi.mocked(f.deps.revalidate).mockRejectedValue(Error('/private unexpected failure'));throw Error('INVALID_IMAGE_DATA');});await expect(f.service.process(f.query(upload.id),f.source)).rejects.toThrow('INVALID_IMAGE_DATA');expect((await f.db.assetUpload.findUniqueOrThrow({where:{id:upload.id}})).status).toBe('processing');
});
it('refuses invalid private token metadata rather than exposing a superficially valid DTO',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.db.assetUpload.update({where:{id:upload.id},data:{status:'processing',processingToken:'bad-token',leaseExpiresAt:new Date('2026-09-12T00:01:00.000Z')}});await expect(f.service.getUpload(f.query(upload.id))).rejects.toThrow('STORED_ASSET_INVALID');
});
it('new complete claim after the 24h TTL fails before opening files, just like process',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);vi.mocked(f.deps.openFiles).mockClear();f.advance(86400000);await expect(f.service.complete(f.complete(upload.id))).rejects.toThrow('ASSET_UPLOAD_EXPIRED');expect(f.deps.openFiles).not.toHaveBeenCalled();expect((await f.service.getUpload(f.query(upload.id))).status).toBe('published');
});
it('a finalizer claimed before TTL may complete after TTL while its original lease remains valid; history remains replayable',async()=>{
 const upload=(await f.service.begin(f.begin())).data;await f.service.process(f.query(upload.id),f.source);f.advance(86400000-10);const ensure=f.files.ensureDurableCandidate.bind(f.files);vi.spyOn(f.files,'ensureDurableCandidate').mockImplementation(async(...args)=>{const evidence=await ensure(...args);f.advance(20);return evidence;});const command=f.complete(upload.id),done=await f.service.complete(command);expect(done.data.status).toBe('ready');expect(await f.service.complete(command)).toEqual({...done,replayed:true});
});
