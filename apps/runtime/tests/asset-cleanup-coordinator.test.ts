import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import {chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {execFileSync, fork, type ChildProcess} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {v7} from 'uuid';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import type {PrismaClient} from '../src/generated/prisma/client.js';
const runtime=fileURLToPath(new URL('..',import.meta.url));
let base:string,dir:string,dbPath:string,db:PrismaClient,ownerId:string,datasetId:string,assetId:string;
const children:ChildProcess[]=[];
const scope=()=>({ownerId,datasetId,assetId});
async function adapter(){const module=await import('../src/infrastructure/db/prisma-asset-cleanup-coordinator.js').catch(()=>null);expect(module,'real SQLite coordinator must exist').not.toBeNull();return module!;}
beforeAll(async()=>{base=await mkdtemp(join(await realpath(tmpdir()),'cleanup-sqlite-base-'));await chmod(base,0o700);const path=join(base,'baseline.db');await writeFile(path,'',{mode:0o600});execFileSync(process.execPath,[join(runtime,'node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:runtime,env:{...process.env,RUNTIME_DATABASE_URL:`file:${path}`},stdio:'pipe'});},30_000);
beforeEach(async()=>{dir=await mkdtemp(join(await realpath(tmpdir()),'cleanup-sqlite-test-'));await chmod(dir,0o700);dbPath=join(dir,'runtime.db');await copyFile(join(base,'baseline.db'),dbPath);db=await openRuntimeDatabase(dbPath);ownerId=v7();datasetId=v7();assetId=v7();await db.localProfile.create({data:{id:ownerId,displayName:'cleanup fixture',createdAt:new Date(),updatedAt:new Date()}});await seedUpload();});
afterEach(async()=>{for(const child of children){if(child.exitCode===null&&child.signalCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exit;}}children.length=0;vi.restoreAllMocks();await db?.$disconnect();await rm(dir,{recursive:true,force:true});});
afterAll(async()=>{await rm(base,{recursive:true,force:true});});
// Direct seeding represents already-committed T1, NOT an implemented upload/T1 service.
async function seedUpload(patch:Record<string,unknown>={}){return db.assetUpload.create({data:{id:v7(),ownerId,assetId,inputSha256:'a'.repeat(64),inputByteSize:1n,originalName:'fixture.webp',rightsDeclaration:'fixture generated',status:'deleting',outputSha256:null,outputByteSize:null,outputWidth:null,outputHeight:null,processingToken:null,leaseExpiresAt:null,createdAt:new Date(),updatedAt:new Date(),expiresAt:new Date(Date.now()+60000),revision:1,...patch}});}
async function seedAsset(patch:Record<string,unknown>={}){return db.asset.create({data:{id:assetId,ownerId,storageKey:`assets/${datasetId}/${assetId}.webp`,sha256:'b'.repeat(64),mimeType:'image/webp',byteSize:1n,originalName:'fixture.webp',width:1,height:1,rightsDeclaration:'fixture',status:'ready',deletedAt:null,createdAt:new Date(),updatedAt:new Date(),revision:1,...patch}});}
it('takes a real owner writer gate, returns the exact sync result object and preserves committed deleting',async()=>{
 const {createAssetCleanupCoordinator}=await adapter(),result={kind:'absent' as const},work=vi.fn(()=>result),coordinator=createAssetCleanupCoordinator(db,{ownerId,datasetId});expect(await coordinator.runExclusive(scope(),work)).toBe(result);expect(work).toHaveBeenCalledTimes(1);expect((await db.localProfile.findUniqueOrThrow({where:{id:ownerId}})).writeEpoch).toBe(1);expect((await db.assetUpload.findMany())[0]?.status).toBe('deleting');
});
it.each(['bad','owner','dataset','extra'])('rejects %s scope before any transaction or callback',async mode=>{
 const {createAssetCleanupCoordinator}=await adapter(),coordinator=createAssetCleanupCoordinator(db,{ownerId,datasetId}),transaction=vi.spyOn(db,'$transaction'),work=vi.fn(()=>({kind:'absent' as const}));const input=mode==='bad'?{...scope(),assetId:'../bad'}:mode==='owner'?{...scope(),ownerId:v7()}:mode==='dataset'?{...scope(),datasetId:v7()}:{...scope(),path:'private'};
 await expect(coordinator.runExclusive(input,work)).rejects.toMatchObject({code:'ASSET_CLEANUP_INVALID_SCOPE',message:'ASSET_CLEANUP_INVALID_SCOPE'});expect(transaction).not.toHaveBeenCalled();expect(work).not.toHaveBeenCalled();
});
it.each(['reserved','processing','published','finalizing','completed','failed','missing','duplicate','foreign','owner-deleted'])('denies %s before callback and rolls back its gate only, preserving T1',async state=>{
 const {createAssetCleanupCoordinator}=await adapter();if(state==='missing')await db.assetUpload.deleteMany();else if(state==='duplicate')await seedUpload();else if(state==='foreign')await db.assetUpload.updateMany({data:{ownerId:v7()}});else if(state==='owner-deleted')await db.localProfile.update({where:{id:ownerId},data:{deletedAt:new Date()}});else await db.assetUpload.updateMany({data:{status:state}});
 const before=await db.assetUpload.findMany(),work=vi.fn(()=>({kind:'removed' as const}));await expect(createAssetCleanupCoordinator(db,{ownerId,datasetId}).runExclusive(scope(),work)).rejects.toMatchObject({code:'ASSET_CLEANUP_NOT_ALLOWED'});expect(work).not.toHaveBeenCalled();expect(await db.assetUpload.findMany()).toEqual(before);expect((await db.localProfile.findUniqueOrThrow({where:{id:ownerId}})).writeEpoch).toBe(0);
});
it.each(['ready','unavailable','soft-deleted','foreign-owner','aliased-path'])('any existing Asset (%s) prevents deletion',async kind=>{
 const {createAssetCleanupCoordinator}=await adapter();await seedAsset(kind==='unavailable'?{status:'unavailable'}:kind==='soft-deleted'?{deletedAt:new Date()}:kind==='foreign-owner'?{ownerId:v7()}:kind==='aliased-path'?{id:v7()}:{});const work=vi.fn(()=>({kind:'removed' as const}));await expect(createAssetCleanupCoordinator(db,{ownerId,datasetId}).runExclusive(scope(),work)).rejects.toMatchObject({code:'ASSET_CLEANUP_NOT_ALLOWED'});expect(work).not.toHaveBeenCalled();expect(await db.asset.count()).toBe(1);
});
it('callback throw is sanitized, rolls back gate, retains deleting, and releases for a real second connection',async()=>{
 const {createAssetCleanupCoordinator}=await adapter();const error=await createAssetCleanupCoordinator(db,{ownerId,datasetId}).runExclusive(scope(),()=>{throw Error('SQL /private/fixture secret');}).catch(e=>e);expect(error).toMatchObject({code:'ASSET_CLEANUP_FAILED',message:'ASSET_CLEANUP_FAILED'});expect(error.cause).toBeUndefined();const second=await openRuntimeDatabase(dbPath);try {expect(await createAssetCleanupCoordinator(second,{ownerId,datasetId}).runExclusive(scope(),()=>({kind:'absent'}))).toEqual({kind:'absent'});} finally {await second.$disconnect();}expect((await db.assetUpload.findMany())[0]?.status).toBe('deleting');
});
async function filesystem(){const host=join(dir,'host');await mkdir(host,{mode:0o700});await mkdir(join(host,'assets'),{mode:0o700});await mkdir(join(host,'assets',datasetId),{mode:0o700});const candidate=join(host,'assets',datasetId,`${assetId}.webp`);await writeFile(candidate,'partial fixture',{mode:0o600});return {host,candidate};}
async function worker(mode:string,host:string,tag:string,override:Partial<ReturnType<typeof scope>>={}){const config={dbPath,host,...scope(),...override,mode,tag,control:dir};const child=fork(fileURLToPath(new URL('./fixtures/asset-cleanup-coordinator/worker.ts',import.meta.url)),[JSON.stringify(config)],{execArgv:['--import',import.meta.resolve('tsx')],env:{},stdio:['ignore','ignore','pipe','ipc']});children.push(child);let stderr='';child.stderr!.on('data',b=>{stderr+=b.toString();});const messages:Record<string,unknown>[]=[];child.on('message',message=>messages.push(message as Record<string,unknown>));const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));await until(()=>messages.some(m=>m.event==='ready'),()=>stderr);return {child,messages,exit,go:()=>child.send('go')};}
async function until(check:()=>boolean,detail=()=>'',limit=5000){const started=Date.now();while(!check()){if(Date.now()-started>limit)throw Error('fixture timeout '+detail());await new Promise(r=>setTimeout(r,10));}}
async function marker(tag:string,event:string){try {return JSON.parse(await readFile(join(dir,`${tag}-${event}.json`),'utf8')) as {time:number};} catch {return null;}}
async function waitMarker(tag:string,event:string){let value:Awaited<ReturnType<typeof marker>>;const start=Date.now();while(!(value=await marker(tag,event))){if(Date.now()-start>5000)throw Error('marker timeout');await new Promise(r=>setTimeout(r,10));}return value;}
it.each(['before-unlink','before-directory-sync'])('SIGKILL at %s releases real SQLite lock; restart retries removed/absent and syncs retained terminal intent',async phase=>{
 await adapter();const {host,candidate}=await filesystem(),a=await worker(phase,host,'a');a.go();await waitMarker('a',phase);expect(await marker('a','finished')).toBeNull();
 if(phase==='before-unlink')expect(await readFile(candidate,'utf8')).toBe('partial fixture');else await expect(lstat(candidate)).rejects.toMatchObject({code:'ENOENT'});
 a.child.kill('SIGKILL');expect(await a.exit).toEqual({code:null,signal:'SIGKILL'});expect((await db.localProfile.findUniqueOrThrow({where:{id:ownerId}})).writeEpoch).toBe(0);const b=await worker('once',host,'b');b.go();await until(()=>b.messages.some(m=>m.event==='done'));expect(b.messages.find(m=>m.event==='done')).toMatchObject({result:{kind:phase==='before-unlink'?'removed':'absent'}});expect(await marker('b','after-directory-sync')).not.toBeNull();expect((await db.assetUpload.findMany())[0]?.status).toBe('deleting');expect(await db.asset.count()).toBe(0);
},15000);
it.each(['same-owner','different-owner'] as const)('two Node processes (%s) cannot overlap real cleanup even when sync critical work exceeds the unchanged 3s transaction timeout',async ownerMode=>{
 await adapter();const {host}=await filesystem();let otherScope=scope();
 if(ownerMode==='different-owner'){otherScope={ownerId:v7(),datasetId,assetId:v7()};await db.localProfile.create({data:{id:otherScope.ownerId,displayName:'second writer',createdAt:new Date(),updatedAt:new Date()}});await seedUpload({ownerId:otherScope.ownerId,assetId:otherScope.assetId});await writeFile(join(host,'assets',datasetId,`${otherScope.assetId}.webp`),'partial second fixture',{mode:0o600});}
 const a=await worker('slow',host,'a'),b=await worker('retry',host,'b',otherScope);a.go();const began=await waitMarker('a','before-unlink');b.go();await until(()=>b.messages.some(m=>m.event==='busy'));expect(await marker('b','critical-entered')).toBeNull();expect(await marker('a','finished')).toBeNull();
 await until(()=>b.messages.some(m=>m.event==='done'),()=>'',9000);const finished=await waitMarker('a','finished'),entered=await waitMarker('b','critical-entered');expect(finished.time-began.time).toBeGreaterThanOrEqual(3300);expect(entered.time).toBeGreaterThanOrEqual(finished.time);expect(b.messages.filter(m=>m.event==='busy').length).toBeGreaterThan(0);for(const failure of b.messages.filter(m=>m.event==='busy'))expect(failure).toEqual({event:'busy',code:'PRIVATE_ASSET_IO'});expect((await db.assetUpload.findMany()).every(row=>row.status==='deleting')).toBe(true);
 await until(()=>a.messages.some(m=>m.event==='done'||m.event==='busy'));
 console.info('SQLite cleanup evidence',JSON.stringify({ownerMode,syncMilliseconds:finished.time-began.time,secondEnteredAfterFS:entered.time-finished.time,blockedAttempts:b.messages.filter(m=>m.event==='busy').length,firstOutcome:a.messages.find(m=>m.event==='done'||m.event==='busy'),secondOutcome:b.messages.find(m=>m.event==='done')}));
},15000);

it('rejects an async callback before database access and invocation',async()=>{
 const {createAssetCleanupCoordinator}=await adapter(),coordinator=createAssetCleanupCoordinator(db,{ownerId,datasetId}),tx=vi.spyOn(db,'$transaction'),called=vi.fn();
 await expect(coordinator.runExclusive(scope(),(async()=>{called();return {kind:'absent'};}) as never)).rejects.toMatchObject({code:'ASSET_CLEANUP_INVALID_CALLBACK'});expect(called).not.toHaveBeenCalled();expect(tx).not.toHaveBeenCalled();
});
it('rejects a wrapped Promise callback without an unhandled rejection and retains deleting for retry',async()=>{
 const {createAssetCleanupCoordinator}=await adapter(),coordinator=createAssetCleanupCoordinator(db,{ownerId,datasetId});
 await expect(coordinator.runExclusive(scope(),(()=>Promise.reject(Error('private async callback'))) as never)).rejects.toMatchObject({code:'ASSET_CLEANUP_INVALID_CALLBACK'});await new Promise(resolve=>setImmediate(resolve));expect((await db.assetUpload.findMany())[0]?.status).toBe('deleting');expect(await coordinator.runExclusive(scope(),()=>({kind:'absent'}))).toEqual({kind:'absent'});
});
it('rejects ambiguous cross-owner upload references rather than filtering the duplicate away',async()=>{
 const {createAssetCleanupCoordinator}=await adapter();await seedUpload({ownerId:v7()});const callback=vi.fn(()=>({kind:'absent' as const}));await expect(createAssetCleanupCoordinator(db,{ownerId,datasetId}).runExclusive(scope(),callback)).rejects.toMatchObject({code:'ASSET_CLEANUP_NOT_ALLOWED'});expect(callback).not.toHaveBeenCalled();
});
