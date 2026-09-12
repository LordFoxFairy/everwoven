import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {v7} from 'uuid';
import {createPrivateAssetStore} from '../src/infrastructure/media/private-asset-store.js';
import {issueDeletionPermitForDeleting} from '../src/infrastructure/media/private-asset-deletion.js';
import type {CleanupCoordinator} from '../src/ports/private-asset-store.js';
import type {ValidatedHost} from '../src/host/storage.js';
let base:string,host:ValidatedHost,assetId:string;
const binding=()=>({ownerId:host.manifest.ownerId,datasetId:host.manifest.datasetId});
const dir=()=>join(host.target.directory,'assets',host.manifest.datasetId);
const path=()=>join(dir(),`${assetId}.webp`);
const permit=()=>issueDeletionPermitForDeleting({...binding(),assetId,status:'deleting'});
// Test-only coordinator. This is not a production SQLite or cross-process locking implementation.
function coordinator():CleanupCoordinator {let tail=Promise.resolve();return {runExclusive:async(_scope,work)=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await previous;try {const result=work();expect(result).not.toBeInstanceOf(Promise);return result;} finally {release();}}};}
async function fixture(){const bytes=await sharp({create:{width:320,height:64,channels:3,background:'red'}}).webp().toBuffer();return {bytes,expected:{mimeType:'image/webp' as const,sha256:createHash('sha256').update(bytes).digest('hex'),byteSize:String(bytes.length),width:320,height:64}};}
beforeEach(async()=>{base=await mkdtemp(join(await realpath(tmpdir()),'asset-recovery-'));await chmod(base,0o700);const directory=join(base,'host');await mkdir(directory,{mode:0o700});host={target:{directory,parent:base,parentIdentity:await lstat(base)},identity:await lstat(directory),manifest:{version:1,ownerId:v7(),datasetId:v7(),environment:'dev',createdAt:'2026-09-12T00:00:00.000Z'}};assetId=v7();});
afterEach(async()=>{vi.restoreAllMocks();await rm(base,{recursive:true,force:true});});
it('requires an explicit coordinator before any directory creation, with no implicit in-process fallback',async()=>{
 await expect(createPrivateAssetStore(host,binding(),undefined as never)).rejects.toMatchObject({code:'PRIVATE_ASSET_INVALID_ARGUMENT'});expect(await readdir(host.target.directory)).toEqual([]);
});
it('never enters cleanup before permit validation or before the coordinator grants its lock',async()=>{
 let grant!:()=>void;const allowed=new Promise<void>(resolve=>{grant=resolve;}),inside=vi.fn(),runExclusive=vi.fn(async(scope,work)=>{expect(scope).toEqual({...binding(),assetId});await allowed;return work();});
 const store=await createPrivateAssetStore(host,binding(),{runExclusive},{cleanupCheckpoint:()=>{inside();}}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);
 await expect(store.removeDeletingCandidate(assetId,{} as never)).rejects.toMatchObject({code:'PRIVATE_ASSET_INVALID_PERMIT'});expect(runExclusive).not.toHaveBeenCalled();expect(inside).not.toHaveBeenCalled();
 const pending=store.removeDeletingCandidate(assetId,permit()).catch(error=>error);try {await Promise.resolve();expect(runExclusive).toHaveBeenCalledTimes(1);expect(inside).not.toHaveBeenCalled();expect(await readFile(path())).toEqual(image.bytes);grant();expect(await pending).toEqual({kind:'removed'});expect(inside).toHaveBeenCalled();expect(await readdir(dir())).toEqual([]);} finally {grant();await pending;}
});
it('denied coordinator authorization executes zero filesystem cleanup callbacks',async()=>{
 const hook=vi.fn(),store=await createPrivateAssetStore(host,binding(),{runExclusive:async()=>{throw Error('private DB denial');}},{cleanupCheckpoint:hook}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);
 await expect(store.removeDeletingCandidate(assetId,permit())).rejects.toMatchObject({code:'PRIVATE_ASSET_IO'});expect(hook).not.toHaveBeenCalled();expect(await readFile(path())).toEqual(image.bytes);
});
it('uses a synchronous fixed-result critical section, keeps error release with the coordinator and permits subsequent cleanup',async()=>{
 const gate=coordinator(),order:string[]=[];let active=false,fail=true;
 const runExclusive:CleanupCoordinator['runExclusive']=(scope,work)=>gate.runExclusive(scope,()=>{expect(active).toBe(false);active=true;order.push('locked');try {const result=work();expect(result).not.toBeInstanceOf(Promise);return result;} finally {active=false;order.push('released');}});
 const store=await createPrivateAssetStore(host,binding(),{runExclusive},{cleanupCheckpoint:stage=>{expect(active).toBe(true);if(stage==='before-unlink'&&fail){fail=false;throw Error('sync fault');}}}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);
 const results=await Promise.allSettled([store.removeDeletingCandidate(assetId,permit()),store.removeDeletingCandidate(assetId,permit())]);expect(results[0]).toMatchObject({status:'rejected',reason:{code:'PRIVATE_ASSET_IO'}});expect(results[1]).toEqual({status:'fulfilled',value:{kind:'removed'}});expect(order).toEqual(['locked','released','locked','released']);
});
it('never calls async I/O hooks from a synchronous cleanup critical section',async()=>{
 let cleaning=false;const hook=vi.fn(async()=>{if(cleaning)throw Error('async hook entered cleanup');});const store=await createPrivateAssetStore(host,binding(),coordinator(),{checkpoint:hook}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);hook.mockClear();cleaning=true;
 expect(await store.removeDeletingCandidate(assetId,permit())).toEqual({kind:'removed'});expect(hook).not.toHaveBeenCalled();
});
it('rejects an async cleanup hook before it can run or allocate directories',async()=>{
 const called=vi.fn();const hook=async()=>{called();return undefined;};await expect(createPrivateAssetStore(host,binding(),coordinator(),{cleanupCheckpoint:hook as never})).rejects.toMatchObject({code:'PRIVATE_ASSET_INVALID_ARGUMENT'});expect(called).not.toHaveBeenCalled();expect(await readdir(host.target.directory)).toEqual([]);
});
it('recovers full bytes after pre-fsync failure and exists, but read-only verify is never durable evidence',async()=>{
 let fail=true;const stages:string[]=[],store=await createPrivateAssetStore(host,binding(),coordinator(),{checkpoint:async(stage,ctx)=>{if(ctx.assetId){stages.push(stage);if(stage==='before-file-sync'&&fail){fail=false;throw Error('fsync fault');}}}}),image=await fixture();
 await expect(store.writeCandidate(assetId,image.bytes,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_IO'});const before=await lstat(path());expect((await store.writeCandidate(assetId,image.bytes,image.expected)).kind).toBe('exists');stages.length=0;
 const read=await store.verifyCandidate(assetId,image.expected);expect(read).not.toHaveProperty('kind');expect(stages).not.toContain('before-file-sync');expect(stages).not.toContain('before-directory-sync');stages.length=0;
 expect(await store.ensureDurableCandidate(assetId,image.expected)).toEqual({kind:'durable',assetId,datasetId:binding().datasetId,metadata:image.expected});expect(stages.indexOf('after-read')).toBeLessThan(stages.indexOf('before-file-sync'));expect(stages.indexOf('before-file-sync')).toBeLessThan(stages.indexOf('before-directory-sync'));expect((await lstat(path())).ino).toBe(before.ino);expect(await readFile(path())).toEqual(image.bytes);
});
it.each(['before-file-sync','before-directory-sync'])('recovery %s failure returns zero durable evidence, leaves bytes and permits another recovery',async stage=>{
 let fail=false;const store=await createPrivateAssetStore(host,binding(),coordinator(),{checkpoint:async(current,ctx)=>{if(fail&&ctx.assetId&&current===stage)throw Error('private fsync failure');}}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);const before=await lstat(path());fail=true;
 await expect(store.ensureDurableCandidate(assetId,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_IO'});expect((await lstat(path())).ino).toBe(before.ino);expect(await readFile(path())).toEqual(image.bytes);fail=false;expect((await store.ensureDurableCandidate(assetId,image.expected)).kind).toBe('durable');
});
it.each(['partial','wrong-hash','wrong-size','wrong-width','wrong-format'])('durable recovery rejects %s without sync, repair or deletion',async kind=>{
 const events:string[]=[],store=await createPrivateAssetStore(host,binding(),coordinator(),{checkpoint:async(stage,ctx)=>{if(ctx.assetId)events.push(stage);}}),image=await fixture();let bytes=image.bytes;let expected={...image.expected};
 if(kind==='partial')bytes=bytes.subarray(0,20);if(kind==='wrong-hash')expected.sha256='a'.repeat(64);if(kind==='wrong-size')expected.byteSize=String(bytes.length+1);if(kind==='wrong-width')expected.width++;
 if(kind==='wrong-format'){bytes=await sharp(image.bytes).png().toBuffer();expected={...expected,sha256:createHash('sha256').update(bytes).digest('hex'),byteSize:String(bytes.length)};}
 await writeFile(path(),bytes,{mode:0o600});await expect(store.ensureDurableCandidate(assetId,expected)).rejects.toBeTruthy();expect(await readFile(path())).toEqual(bytes);expect(events).not.toContain('before-file-sync');expect(events).not.toContain('before-directory-sync');
});

it('sync directory fsync failure after unlink releases the coordinator and retries absence without any lock file',async()=>{
 let fail=true;const store=await createPrivateAssetStore(host,binding(),coordinator(),{cleanupCheckpoint:stage=>{if(stage==='before-directory-sync'&&fail){fail=false;throw Error('sync directory fault');}}}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);
 await expect(store.removeDeletingCandidate(assetId,permit())).rejects.toMatchObject({code:'PRIVATE_ASSET_IO'});expect(await readdir(dir())).toEqual([]);expect(await store.removeDeletingCandidate(assetId,permit())).toEqual({kind:'absent'});expect(await readdir(dir())).toEqual([]);
});
it.each(['host','assets','dataset'] as const)('sync cleanup detects %s replacement, keeps both trees untouched and never adopts a new baseline',async level=>{
 const hook=vi.fn(),store=await createPrivateAssetStore(host,binding(),coordinator(),{cleanupCheckpoint:hook}),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);const original=level==='host'?host.target.directory:level==='assets'?join(host.target.directory,'assets'):dir();
 await rename(original,original+'-old');await mkdir(original,{mode:0o700});await expect(store.removeDeletingCandidate(assetId,permit())).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});expect(hook).not.toHaveBeenCalled();expect(await readdir(original)).toEqual([]);
 await rm(original,{recursive:true});await rename(original+'-old',original);await expect(store.removeDeletingCandidate(assetId,permit())).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});expect(await readFile(path())).toEqual(image.bytes);
});
it('sync cleanup rejects a newly unsafe ancestor using the same policy as asynchronous operations',async()=>{
 const store=await createPrivateAssetStore(host,binding(),coordinator()),image=await fixture();await store.writeCandidate(assetId,image.bytes,image.expected);await chmod(base,0o777);
 try {await expect(store.removeDeletingCandidate(assetId,permit())).rejects.toMatchObject({code:'PRIVATE_ASSET_STORE_INVALIDATED'});expect(await readFile(path())).toEqual(image.bytes);} finally {await chmod(base,0o700);}
});
it('durable recovery fails on a missing file without creating it',async()=>{
 const store=await createPrivateAssetStore(host,binding(),coordinator()),image=await fixture();await expect(store.ensureDurableCandidate(assetId,image.expected)).rejects.toMatchObject({code:'PRIVATE_ASSET_NOT_FOUND'});expect(await readdir(dir())).toEqual([]);
});
