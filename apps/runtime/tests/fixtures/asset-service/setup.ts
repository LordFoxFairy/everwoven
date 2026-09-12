import {execFileSync} from 'node:child_process';
import {chmod,copyFile,lstat,mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {v7} from 'uuid';
import sharp from 'sharp';
import {vi,expect} from 'vitest';
import {openRuntimeDatabase} from '../../../src/infrastructure/db/client.js';
import {createPrivateAssetStore} from '../../../src/infrastructure/media/private-asset-store.js';
import {createImageBodyReceiver} from '../../../src/infrastructure/media/image-body-receiver.js';
import {createImageNormalizer} from '../../../src/infrastructure/media/sharp-image-normalizer.js';
import {createAssetCleanupCoordinator} from '../../../src/infrastructure/db/prisma-asset-cleanup-coordinator.js';
import type {AssetServiceDependencies} from '../../../src/ports/asset-service.js';
let baseline:string;
export async function prepare(){baseline=await mkdtemp(join(await realpath(tmpdir()),'asset-service-base-'));await chmod(baseline,0o700);const path=join(baseline,'base.db');await writeFile(path,'',{mode:0o600});const runtime=fileURLToPath(new URL('../../../',import.meta.url));execFileSync(process.execPath,[join(runtime,'node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:runtime,env:{...process.env,RUNTIME_DATABASE_URL:`file:${path}`},stdio:'pipe'});}
export async function dispose(){await rm(baseline,{recursive:true,force:true});}
export async function fixture(){
 const module=await import('../../../src/composition/asset-service.js').catch(()=>null);expect(module,'asset lifecycle composition must exist').not.toBeNull();
 const dir=await mkdtemp(join(await realpath(tmpdir()),'asset-service-'));await chmod(dir,0o700);const path=join(dir,'runtime.db');await copyFile(join(baseline,'base.db'),path);const db=await openRuntimeDatabase(path),owner={ownerId:v7(),datasetId:v7()},hostPath=join(dir,'host');await mkdir(hostPath,{mode:0o700});let time=new Date('2026-09-12T00:00:00.000Z');await db.localProfile.create({data:{id:owner.ownerId,displayName:'service fixture',createdAt:time,updatedAt:time}});
 const bytes=await sharp({create:{width:320,height:256,channels:3,background:'red'}}).png().toBuffer();
 const source={openBody:vi.fn(()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close();}}))};
 const revalidate=vi.fn(async()=>{}),normalizer=createImageNormalizer(),files=await createPrivateAssetStore({target:{directory:hostPath,parent:dir,parentIdentity:await lstat(dir)},identity:await lstat(hostPath),manifest:{version:1,...owner,environment:'dev',createdAt:time.toISOString()}},owner,createAssetCleanupCoordinator(db,owner));
 const deps:AssetServiceDependencies={owner,revalidate,openFiles:vi.fn(async()=>files),normalizer,receiver:createImageBodyReceiver(),services:{clock:{now:()=>new Date(time)},ids:{next:v7}}};
 const service=module!.createAssetService(db,deps),begin=()=>({datasetId:owner.datasetId,commandId:v7(),inputSha256:createHash('sha256').update(bytes).digest('hex'),inputByteSize:String(bytes.length),originalName:'generated.png',rightsDeclaration:'fixture own art'});
 return {db,dir,owner,files,deps,service,source,bytes,begin,advance:(ms:number)=>{time=new Date(time.getTime()+ms);},query:(uploadId:string)=>({datasetId:owner.datasetId,uploadId}),complete:(uploadId:string)=>({datasetId:owner.datasetId,uploadId,commandId:v7()}),candidate:(assetId:string)=>join(hostPath,'assets',owner.datasetId,`${assetId}.webp`),close:async()=>{await db.$disconnect();await rm(dir,{recursive:true,force:true});}};
}
export type Fixture=Awaited<ReturnType<typeof fixture>>;
