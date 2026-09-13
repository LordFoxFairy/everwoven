import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import {issueConnectionCode} from '../src/host/index.js';
import {prepare,dispose,fixture,type Fixture} from './fixtures/host-assets/setup.js';
import {PrismaAssetMaintenanceStore} from '../src/infrastructure/db/prisma-asset-maintenance-store.js';
import {createAssetMaintenance} from '../src/application/asset-maintenance.js';
let f:Fixture;
beforeAll(prepare,30000);afterAll(dispose);
beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f.close();});
const createdAt=new Date('2026-09-10T00:00:00.000Z');
async function insert(id=v7(),date=createdAt){
 return f.database(db=>db.assetUpload.create({data:{id,ownerId:f.manifest.ownerId,assetId:v7(),inputSha256:'a'.repeat(64),inputByteSize:1n,originalName:'fixture',rightsDeclaration:'fixture',status:'failed',createdAt:date,updatedAt:date,expiresAt:date}}));
}
it.each([true,false])('real SQLite invalid business ID occupies a row and cursor advances; apply=%s',async apply=>{
 const first=await insert(),second=await insert();
 await f.database(db=>db.assetUpload.update({where:{id:first.id},data:{id:'!not-a-business-uuid'}}));
 await f.database(async db=>{
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));
  const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  const input={datasetId:f.manifest.datasetId,apply,limit:1};
  const a=await run(input);expect(a).toMatchObject({examined:1,items:[{uploadId:'!not-a-business-uuid',outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'}]});
  expect(a.nextCursor).toBeTypeOf('string');expect(cleanup).not.toHaveBeenCalled();
  expect(await run(input)).toEqual(a); // Starting again safely reports the same bad row, not an exception.
  const b=await run({...input,cursor:a.nextCursor!});
  expect(b.items).toEqual([{uploadId:second.id,outcome:apply?'absent':'preview'}]);
  if(apply)expect(cleanup).toHaveBeenCalledExactlyOnceWith({datasetId:f.manifest.datasetId,uploadId:second.id});else expect(cleanup).not.toHaveBeenCalled();
  expect((await run({...input,cursor:b.nextCursor!})).examined).toBe(0);
 });
});
it('SQLite BINARY Unicode order, not JS UTF-16 order, advances over tied invalid IDs',async()=>{
 const ids=['\uE000','\u{10000}'];for(const id of ids)await insert(id);
 const good=await insert(v7(),new Date(createdAt.getTime()+1));
 await f.database(async db=>{
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  const input={datasetId:f.manifest.datasetId,apply:true,limit:2};const first=await run(input);
  expect(first.items.map(row=>[row.uploadId,row.outcome])).toEqual(ids.map(id=>[id,'error']));expect(cleanup).not.toHaveBeenCalled();
  expect((await run({...input,cursor:first.nextCursor!})).items).toEqual([{uploadId:good.id,outcome:'absent'}]);expect(cleanup).toHaveBeenCalledExactlyOnceWith({datasetId:f.manifest.datasetId,uploadId:good.id});
 });
});
it('a maximally escaped bounded ID produces a consumable cursor within the 1024 character cap',async()=>{
 const bad='\\'.repeat(128);await insert(bad);const good=await insert(v7(),new Date(createdAt.getTime()+1));
 await f.database(async db=>{
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  const input={datasetId:f.manifest.datasetId,apply:true,limit:1};const first=await run(input);
  expect(first.items).toEqual([{uploadId:bad,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'}]);expect(cleanup).not.toHaveBeenCalled();expect(first.nextCursor!.length).toBeLessThanOrEqual(1024);
  expect((await run({...input,cursor:first.nextCursor!})).items).toEqual([{uploadId:good.id,outcome:'absent'}]);
 });
});
it.each(['x'.repeat(129),'图'.repeat(43),'bad\u0000id','bad\nline'])('out-of-domain pagination ID fails closed before cleanup',async bad=>{
 await insert(bad);await f.database(async db=>{
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  await expect(run({datasetId:f.manifest.datasetId,apply:true,limit:1})).rejects.toThrow('ASSET_MAINTENANCE_FAILED');expect(cleanup).not.toHaveBeenCalled();
 });
});
it.each(['2026-09-10T00:00:00.000Z','2026-09-10T00:00:00+00:00'])('noncanonical stored timestamp %s cannot yield a lossy repeating cursor',async key=>{
 const row=await insert();await f.database(async db=>{
  await db.$executeRaw`UPDATE asset_uploads SET created_at=${key} WHERE id=${row.id}`;
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  await expect(run({datasetId:f.manifest.datasetId,apply:true,limit:1})).rejects.toThrow('ASSET_MAINTENANCE_FAILED');expect(cleanup).not.toHaveBeenCalled();
 });
});
it('forged position is not authority: cross-scope, oversized and malformed scalar cursors never reach the store',async()=>{
 const store={list:vi.fn()},cleanup=vi.fn();const owner={ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId};const run=createAssetMaintenance(store,{owner,revalidate:async()=>{},cleanup});
 for(const patch of [{id:'x'.repeat(129)},{id:'\ud800'},{ownerId:v7()},{datasetId:v7()},{createdAt:'+010000-01-01T00:00:00.000Z'}]){
  const cursor=Buffer.from(JSON.stringify({...owner,id:'!valid-position',createdAt:createdAt.toISOString(),...patch})).toString('base64url');
  await expect(run({datasetId:owner.datasetId,cursor,apply:true})).rejects.toThrow('INVALID_ASSET_MAINTENANCE_CURSOR');
 }
 expect(store.list).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
});

it('real CLI returns exit 2 + cursor for invalid ID, next page cleans only the valid ID',async()=>{
 await insert('!bad-id');const good=await insert();
 async function cli(cursor?:string){
  const code=await issueConnectionCode(f.directory,'dev');
  const args=['--import',createRequire(import.meta.url).resolve('tsx'),fileURLToPath(new URL('../src/host/cli.ts',import.meta.url)),'maintain-assets','--directory',f.directory,'--environment','dev','--dataset',f.manifest.datasetId,'--apply','--limit','1',...(cursor?['--cursor',cursor]:[])];
  const proc=spawn(process.execPath,args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  proc.stdout.on('data',chunk=>stdout+=chunk);proc.stderr.on('data',chunk=>stderr+=chunk);proc.stdin.on('error',()=>{});
  const timer=setTimeout(()=>proc.kill('SIGKILL'),10000);
  const ended=new Promise<number|null>((resolve,reject)=>{proc.on('error',reject);proc.on('close',resolve);});
  try{proc.stdin.end(code);const exit=await ended;expect(stderr).toBe('');expect(stdout).not.toContain(code);return {exit,result:JSON.parse(stdout)};}
  finally{clearTimeout(timer);if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');}
 }
 const before=await f.database(db=>db.localProfile.findUniqueOrThrow({where:{id:f.manifest.ownerId}}));
 const first=await cli();expect(first.exit).toBe(2);expect(first.result.items).toEqual([{uploadId:'!bad-id',outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'}]);
 await expect(access(f.assetsPath)).rejects.toMatchObject({code:'ENOENT'});
 expect((await f.database(db=>db.localProfile.findUniqueOrThrow({where:{id:f.manifest.ownerId}}))).writeEpoch).toBe(before.writeEpoch);
 const next=await cli(first.result.nextCursor);expect(next.exit).toBe(0);expect(next.result.items).toEqual([{uploadId:good.id,outcome:'absent'}]);
});
it('empty TEXT identity remains a bounded position, never cleanup authority',async()=>{
 await insert('');const good=await insert();await f.database(async db=>{
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  const input={datasetId:f.manifest.datasetId,apply:true,limit:1};const first=await run(input);
  expect(first.items).toEqual([{uploadId:'',outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'}]);expect(cleanup).not.toHaveBeenCalled();
  expect((await run({...input,cursor:first.nextCursor!})).items).toEqual([{uploadId:good.id,outcome:'absent'}]);
 });
});
it('invalid UTF-8 persisted TEXT fails closed instead of rebinding a replacement-character cursor',async()=>{
 const row=await insert();await f.database(async db=>{
  await db.$executeRaw`UPDATE asset_uploads SET id=CAST(${Buffer.from([0x80])} AS TEXT) WHERE id=${row.id}`;
  const cleanup=vi.fn(async()=>({kind:'absent' as const}));const run=createAssetMaintenance(new PrismaAssetMaintenanceStore(db),{owner:{ownerId:f.manifest.ownerId,datasetId:f.manifest.datasetId},revalidate:async()=>{},cleanup});
  await expect(run({datasetId:f.manifest.datasetId,apply:true,limit:1})).rejects.toThrow('ASSET_MAINTENANCE_FAILED');expect(cleanup).not.toHaveBeenCalled();
 });
});
