import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, link, writeFile} from 'node:fs/promises';
import {renameSync, writeFileSync} from 'node:fs';
import type {PrivateAssetFaults} from '../src/infrastructure/media/private-asset-store.js';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {v7} from 'uuid';
import type {ValidatedHost} from '../src/host/storage.js';

let base:string,host:ValidatedHost,assetId:string;
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const binding=()=>({ownerId:host.manifest.ownerId,datasetId:host.manifest.datasetId});
const dataset=()=>join(host.target.directory,'assets',host.manifest.datasetId);
const candidate=()=>join(dataset(),`${assetId}.webp`);
// These filesystem unit fixtures inject an explicit test-only coordinator, not a production lock adapter.
async function modules(){const store=await import('../src/infrastructure/media/private-asset-store.js').catch(()=>null),permits=await import('../src/infrastructure/media/private-asset-deletion.js').catch(()=>null);expect(store,'private file boundary must exist').not.toBeNull();expect(permits,'internal deleting permit boundary must exist').not.toBeNull();return {...store!,...permits!,createPrivateAssetStore:(host:ValidatedHost,binding:{ownerId:string;datasetId:string},faults?:PrivateAssetFaults)=>store!.createPrivateAssetStore(host,binding,{runExclusive:async(_scope,work)=>work()},faults)};}
async function fixture(width=320,height=64){const bytes=await sharp({create:{width,height,channels:4,background:{r:80,g:120,b:200,alpha:0.5}}}).webp({quality:80,alphaQuality:100,effort:4}).toBuffer();return {bytes,expected:{mimeType:'image/webp' as const,sha256:digest(bytes),byteSize:String(bytes.length),width,height}};}
async function trustedHost(directory:string):Promise<ValidatedHost>{await mkdir(directory,{mode:0o700});const parent=join(directory,'..');return {target:{directory,parent:await realpath(parent),parentIdentity:await lstat(parent)},identity:await lstat(directory),manifest:{version:1,ownerId:v7(),datasetId:v7(),environment:'dev',createdAt:'2026-09-12T00:00:00.000Z'}};}
beforeEach(async()=>{base=await mkdtemp(join(await realpath(tmpdir()),'private-asset-'));await chmod(base,0o700);host=await trustedHost(join(base,'host'));assetId=v7();});
afterEach(async()=>{vi.restoreAllMocks();await chmod(base,0o700);await rm(base,{recursive:true,force:true});});
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

it('creates durable private directories and exclusive 0600/nlink1 candidates, returning evidence rather than ready',async()=>{
 const m=await modules(),events:string[]=[];const store=await m.createPrivateAssetStore(host,binding(),{checkpoint:async(stage,context)=>{events.push(`${stage}:${context.directory??'file'}`);}});const image=await fixture();
 expect((await lstat(join(host.target.directory,'assets'))).mode&0o777).toBe(0o700);expect((await lstat(dataset())).mode&0o777).toBe(0o700);
 for(const dir of ['host','assets','dataset'])expect(events).toContain(`after-directory-sync:${dir}`);
 const result=await store.writeCandidate(assetId,image.bytes,image.expected);expect(result).toEqual({kind:'durable',assetId,datasetId:binding().datasetId,metadata:image.expected});expect(result).not.toHaveProperty('ready');
 const stat=await lstat(candidate());expect(stat.mode&0o777).toBe(0o600);expect(stat.nlink).toBe(1);expect(await readFile(candidate())).toEqual(image.bytes);
 const verified=await store.verifyCandidate(assetId,image.expected);expect(verified.bytes).toBeInstanceOf(Buffer);expect(verified.bytes).toEqual(image.bytes);expect(verified.metadata).toEqual(image.expected);
});
it('two cooperative instances race O_EXCL; an existing candidate is never truncated, appended, or accepted as durable',async()=>{
 const m=await modules(),[a,b]=await Promise.all([m.createPrivateAssetStore(host,binding()),m.createPrivateAssetStore(host,binding())]),image=await fixture();
 const result=await Promise.all([a.writeCandidate(assetId,image.bytes,image.expected),b.writeCandidate(assetId,image.bytes,image.expected)]);expect(result.map(r=>r.kind).sort()).toEqual(['durable','exists']);
 const before=await lstat(candidate());expect((await b.writeCandidate(assetId,image.bytes,image.expected)).kind).toBe('exists');expect((await lstat(candidate())).ino).toBe(before.ino);expect(await readFile(candidate())).toEqual(image.bytes);
});
it('loops real short writes and verifies bytes through the same read/write handle',async()=>{
 const m=await modules(),write=vi.fn(async(handle,bytes,offset,length,position)=>(await handle.write(bytes,offset,Math.min(7,length),position)).bytesWritten);
 const store=await m.createPrivateAssetStore(host,binding(),{write}),image=await fixture();expect((await store.writeCandidate(assetId,image.bytes,image.expected)).kind).toBe('durable');expect(write.mock.calls.length).toBeGreaterThan(1);expect(await readFile(candidate())).toEqual(image.bytes);
});
it.each(['ENOSPC','zero-write','abort','file-sync','directory-sync'])('closes but never unlinks or repairs a failed %s candidate',async fault=>{
 const m=await modules(),abort=new AbortController();let calls=0;
 const store=await m.createPrivateAssetStore(host,binding(),{
  write:async(handle,bytes,offset,length,position)=>{calls++;if(fault==='zero-write')return 0;if(fault==='ENOSPC'&&calls>1)throw Object.assign(Error('/private/internal detail'),{code:'ENOSPC'});const result=await handle.write(bytes,offset,Math.min(17,length),position);if(fault==='abort')abort.abort();return result.bytesWritten;},
  checkpoint:async(stage,context)=>{if(context.assetId&&((fault==='file-sync'&&stage==='before-file-sync')||(fault==='directory-sync'&&stage==='before-directory-sync')))throw Error('/secret sync detail');}
 });const image=await fixture();await expect(store.writeCandidate(assetId,image.bytes,image.expected,abort.signal)).rejects.toMatchObject({code:fault==='abort'?'PRIVATE_ASSET_ABORTED':'PRIVATE_ASSET_IO'});
 const residue=await readFile(candidate());expect(residue.length).toBe(fault==='zero-write'?0:fault==='ENOSPC'||fault==='abort'?17:image.bytes.length);
 expect((await store.writeCandidate(assetId,image.bytes,image.expected)).kind).toBe('exists');expect(await readFile(candidate())).toEqual(residue);
});
it('an already-aborted write opens no candidate',async()=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding()),image=await fixture(),abort=new AbortController();abort.abort();await expect(store.writeCandidate(assetId,image.bytes,image.expected,abort.signal)).rejects.toMatchObject({code:'PRIVATE_ASSET_ABORTED'});expect(await readdir(dataset())).toEqual([]);
});
it.each(['sha256','byteSize','width','height','mimeType'])('verification rejects wrong expected %s and never changes the candidate',async key=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding()),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);const patch={sha256:'a'.repeat(64),byteSize:String(image.bytes.length+1),width:321,height:65,mimeType:'image/png'};
 await expect(store.verifyCandidate(assetId,{...image.expected,[key]:patch[key as keyof typeof patch]} as never)).rejects.toBeTruthy();expect(await readFile(candidate())).toEqual(image.bytes);
});
it('rejects malformed, oversized, truncated and metadata-bearing candidate files via actual decode',async()=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding()),image=await fixture();
 const inputs=[await sharp({create:{width:320,height:64,channels:3,background:'blue'}}).png().toBuffer(),image.bytes.subarray(0,image.bytes.length-3),await sharp(image.bytes).withExif({IFD0:{Artist:'private-fixture'}}).webp().toBuffer()];
 for(const bytes of inputs){const id=v7();await writeFile(join(dataset(),`${id}.webp`),bytes,{mode:0o600});await expect(store.verifyCandidate(id,{...image.expected,sha256:digest(bytes),byteSize:String(bytes.length)})).rejects.toBeTruthy();}
 await writeFile(candidate(),Buffer.alloc(10*1024*1024+1),{mode:0o600});await expect(store.verifyCandidate(assetId,image.expected)).rejects.toBeTruthy();
});
it('returns the original verified descriptor bytes after the filename is replaced, never reopens by path',async()=>{
 const m=await modules();let enabled=false;const image=await fixture(),replacement=Buffer.from('replacement must never be returned');
 const store=await m.createPrivateAssetStore(host,binding(),{checkpoint:async(stage)=>{if(enabled&&stage==='after-read'){enabled=false;await rename(candidate(),join(dataset(),'held-original'));await writeFile(candidate(),replacement,{mode:0o600});}}});await store.writeCandidate(assetId,image.bytes,image.expected);enabled=true;
 expect((await store.verifyCandidate(assetId,image.expected)).bytes).toEqual(image.bytes);expect(await readFile(candidate())).toEqual(replacement);
});
it.each(['host','assets','dataset'])('detects %s replacement and permanently rejects instead of adopting a new baseline',async level=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding()),image=await fixture();const path=level==='host'?host.target.directory:level==='assets'?join(host.target.directory,'assets'):dataset(),backup=path+'-old';
 await rename(path,backup);await mkdir(path,{mode:0o700});await expect(store.writeCandidate(assetId,image.bytes,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});
 await rm(path,{recursive:true});await rename(backup,path);await expect(store.writeCandidate(assetId,image.bytes,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});expect(await readdir(dataset())).toEqual([]);
});
it.each(['assets','dataset'])('rejects a symlink %s without touching its target',async level=>{
 const m=await modules(),outside=join(base,'outside');await mkdir(outside,{mode:0o700});if(level==='dataset')await mkdir(join(host.target.directory,'assets'),{mode:0o700});await symlink(outside,level==='assets'?join(host.target.directory,'assets'):dataset());
 await expect(m.createPrivateAssetStore(host,binding())).rejects.toBeTruthy();expect(await readdir(outside)).toEqual([]);
});
it.each([0o777,0o770,0o707])('rejects nonsticky writable ancestors even when the immediate parent is private (%s)',async mode=>{
 const m=await modules(),unsafe=join(base,'shared');await mkdir(unsafe,{mode});await chmod(unsafe,mode);await mkdir(join(unsafe,'private'),{mode:0o700});host=await trustedHost(join(unsafe,'private','host'));
 await expect(m.createPrivateAssetStore(host,binding())).rejects.toBeTruthy();expect(await readdir(host.target.directory)).toEqual([]);
});
it('allows a verified owned sticky temporary-style ancestor, pins it, and invalidates if sticky protection disappears',async()=>{
 const m=await modules(),sticky=join(base,'sticky');await mkdir(sticky,{mode:0o1777});await chmod(sticky,0o1777);host=await trustedHost(join(sticky,'host'));const store=await m.createPrivateAssetStore(host,binding()),image=await fixture();await chmod(sticky,0o777);
 await expect(store.writeCandidate(assetId,image.bytes,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});expect(await readdir(dataset())).toEqual([]);
});
it.each(['symlink','hardlink','mode','directory'])('rejects unsafe candidate %s metadata',async kind=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding()),image=await fixture(),other=join(base,'other');await writeFile(other,image.bytes,{mode:0o600});
 if(kind==='symlink')await symlink(other,candidate());else if(kind==='hardlink')await link(other,candidate());else if(kind==='directory')await mkdir(candidate(),{mode:0o700});else await writeFile(candidate(),image.bytes,{mode:0o644});
 await expect(store.verifyCandidate(assetId,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_UNSAFE_FILE'});expect(await readFile(other)).toEqual(image.bytes);
});
it('rejects wrong owner/dataset before directory creation and wrong IDs/foreign fields before candidate I/O',async()=>{
 const m=await modules();for(const b of [{...binding(),ownerId:v7()},{...binding(),datasetId:v7()}])await expect(m.createPrivateAssetStore(host,b)).rejects.toMatchObject({code:'PRIVATE_ASSET_BINDING_MISMATCH'});expect(await readdir(host.target.directory)).toEqual([]);
 const events=vi.fn(),store=await m.createPrivateAssetStore(host,binding(),{checkpoint:events}),image=await fixture();events.mockClear();for(const id of ['../x','/tmp/x','00000000-7000-4000-8000-000000000001',`${v7()}/${assetId}`,{assetId,datasetId:v7()}])await expect(store.writeCandidate(id as string,image.bytes,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_INVALID_ARGUMENT'});
 await expect(store.writeCandidate(assetId,image.bytes,{...image.expected,datasetId:v7()} as never)).rejects.toMatchObject({code:'PRIVATE_ASSET_INVALID_ARGUMENT'});expect(events).not.toHaveBeenCalled();expect(await readdir(dataset())).toEqual([]);
});
it('requires an authentic internal deleting permit; rejects fabricated/cross-asset/cross-dataset permits before unlink',async()=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding()),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);
 for(const permit of [{},m.issueDeletionPermitForDeleting({...binding(),assetId:v7(),status:'deleting'}),m.issueDeletionPermitForDeleting({...binding(),datasetId:v7(),assetId,status:'deleting'})])await expect(store.removeDeletingCandidate(assetId,permit as never)).rejects.toMatchObject({code:'PRIVATE_ASSET_INVALID_PERMIT'});
 expect(await readFile(candidate())).toEqual(image.bytes);expect(()=>m.issueDeletionPermitForDeleting({...binding(),assetId,status:'completed'} as never)).toThrow('PRIVATE_ASSET_INVALID_PERMIT');
});
it('a late writer may create after cleanup; reusable terminal permission removes that residue on a later pass',async()=>{
 const m=await modules(),entered=deferred(),release=deferred();const writer=await m.createPrivateAssetStore(host,binding(),{checkpoint:async stage=>{if(stage==='before-create'){entered.release();await release.promise;}}}),cleaner=await m.createPrivateAssetStore(host,binding()),image=await fixture(),permit=m.issueDeletionPermitForDeleting({...binding(),assetId,status:'deleting'});
 const late=writer.writeCandidate(assetId,image.bytes,image.expected);await entered.promise;expect(await cleaner.removeDeletingCandidate(assetId,permit)).toEqual({kind:'absent'});release.release();expect((await late).kind).toBe('durable');expect(await readFile(candidate())).toEqual(image.bytes);expect(await cleaner.removeDeletingCandidate(assetId,permit)).toEqual({kind:'removed'});expect(await readdir(dataset())).toEqual([]);
});
it('cleanup may remove an opened partial candidate; its failed old writer only closes and never unlinks a replacement',async()=>{
 const m=await modules(),entered=deferred(),release=deferred(),image=await fixture();const writer=await m.createPrivateAssetStore(host,binding(),{checkpoint:async stage=>{if(stage==='after-create'){entered.release();await release.promise;}}}),cleaner=await m.createPrivateAssetStore(host,binding());const late=writer.writeCandidate(assetId,image.bytes,image.expected).catch(error=>error);await entered.promise;
 await cleaner.removeDeletingCandidate(assetId,m.issueDeletionPermitForDeleting({...binding(),assetId,status:'deleting'}));await writeFile(candidate(),'later residue',{mode:0o600});release.release();expect(await late).toMatchObject({code:'PRIVATE_ASSET_UNSAFE_FILE'});expect(await readFile(candidate(),'utf8')).toBe('later residue');
});
it('detects replacement before unlink and leaves the new inode untouched rather than claiming atomic conditional deletion',async()=>{
 const m=await modules(),image=await fixture();let swap=false;const store=await m.createPrivateAssetStore(host,binding(),{cleanupCheckpoint:stage=>{if(stage==='before-unlink'&&swap){swap=false;renameSync(candidate(),join(dataset(),'old-inode'));writeFileSync(candidate(),'replacement',{mode:0o600});}}});await store.writeCandidate(assetId,image.bytes,image.expected);swap=true;
 await expect(store.removeDeletingCandidate(assetId,m.issueDeletionPermitForDeleting({...binding(),assetId,status:'deleting'}))).rejects.toMatchObject({code:'PRIVATE_ASSET_UNSAFE_FILE'});expect(await readFile(candidate(),'utf8')).toBe('replacement');
});
it('detects a directory replacement even at the final sync checkpoint and never returns durable evidence',async()=>{
 const m=await modules(),image=await fixture();const store=await m.createPrivateAssetStore(host,binding(),{checkpoint:async(stage,context)=>{if(stage==='after-directory-sync'&&context.assetId){await rename(dataset(),dataset()+'-old');await mkdir(dataset(),{mode:0o700});}}});
 await expect(store.writeCandidate(assetId,image.bytes,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});expect(await readdir(dataset())).toEqual([]);expect(await readFile(join(dataset()+'-old',`${assetId}.webp`))).toEqual(image.bytes);
});
it.each(['assets','dataset'] as const)('pins a newly created %s before a detectable replacement',async level=>{
 const m=await modules();await expect(m.createPrivateAssetStore(host,binding(),{checkpoint:async(stage,context)=>{if(stage==='after-directory-create'&&context.directory===level){const path=level==='assets'?join(host.target.directory,'assets'):dataset();await rename(path,path+'-old');await mkdir(path,{mode:0o700});}}})).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});
});
it.each(['assets','dataset','host'] as const)('fails closed on %s directory creation sync fault, leaving only private directories for retry',async level=>{
 const m=await modules();await expect(m.createPrivateAssetStore(host,binding(),{checkpoint:async(stage,context)=>{if(stage==='before-directory-sync'&&context.directory===level)throw Error('private fsync fault');}})).rejects.toBeTruthy();
 const store=await m.createPrivateAssetStore(host,binding()),image=await fixture();expect((await store.writeCandidate(assetId,image.bytes,image.expected)).kind).toBe('durable');
});
it('never accepts a lying short-write hook in place of actual bytes and exposes only fixed errors',async()=>{
 const m=await modules(),store=await m.createPrivateAssetStore(host,binding(),{write:async(_handle,_bytes,_offset,length)=>length}),image=await fixture();const error=await store.writeCandidate(assetId,image.bytes,image.expected).catch(e=>e);expect(error).toMatchObject({code:'PRIVATE_ASSET_CONTENT_INVALID',message:'PRIVATE_ASSET_CONTENT_INVALID'});expect(error.cause).toBeUndefined();expect((await readFile(candidate())).length).toBe(0);
});
