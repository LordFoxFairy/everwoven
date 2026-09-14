import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {mkdtemp, realpath, rm, readFile, writeFile, unlink, chmod, symlink, link, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {v7} from 'uuid';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {raceOpenedFile} from './local-host-races.js';
import {initializeLocalHost, initializeHost, readLocalHost, validatedHost, digest} from '../src/host/storage.js';
import {acquireLocalStoreAuthority, initializeLocalStoreEpoch} from '../src/host/store-epoch.js';
let parent:string, directory:string;
beforeAll(async()=>{parent=await mkdtemp(join(await realpath(tmpdir()),'store-epoch-'));directory=join(parent,'host');await initializeLocalHost(directory,'dev');});
afterAll(async()=>{await rm(parent,{recursive:true,force:true});});
const path=()=>join(directory,'store-epoch.json');
describe('persistent host generation authority',()=>{
 it('publishes no ready marker on failure after the durable epoch was created',async()=>{
  const target=join(parent,'interrupted-initialization');let epochFound=false;
  await expect(initializeHost(target,'dev',{beforePublish:async()=>{
   epochFound=Boolean(JSON.parse(await readFile(join(target,'store-epoch.json'),'utf8')).storeEpoch);
   await expect(readFile(join(target,'manifest.json'))).rejects.toMatchObject({code:'ENOENT'});
   throw Error('SIMULATED_STOP');
  }})).rejects.toThrow('LOCAL_HOST_INVALID');
  expect(epochFound).toBe(true);await expect(acquireLocalStoreAuthority(target,'dev')).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
 });
 it('uses the explicit CLI without disclosing the epoch and reads the same state in a separate process',async()=>{
  const runtime=fileURLToPath(new URL('../',import.meta.url));
  const original=(await acquireLocalStoreAuthority(directory,'dev')).storeEpoch;
  const output=execFileSync(process.execPath,['--import','tsx','src/host/cli.ts','init-epoch','--directory',directory,'--environment','dev'],{cwd:runtime,encoding:'utf8'});
  expect(output).toBe('Local generation authority initialized.\n');expect(output).not.toContain(original);
  expect((await acquireLocalStoreAuthority(directory,'dev')).storeEpoch).toBe(original);
 });
 it('serializes concurrent initial registration and leaves only one stable record',async()=>{
  const saved=await readFile(path());await unlink(path());
  try{
   const results=await Promise.allSettled([initializeLocalStoreEpoch(directory,'dev'),initializeLocalStoreEpoch(directory,'dev')]);
   expect(results.some(r=>r.status==='fulfilled')).toBe(true);
   const stable=await acquireLocalStoreAuthority(directory,'dev');
   for(const r of results)if(r.status==='fulfilled')expect(r.value).toBe(stable.storeEpoch);
  }finally{await writeFile(path(),saved,{mode:0o600});}
 });
 it('rejects an epoch pathname replacement after open and closes the real descriptor',async()=>{
  const saved=await readFile(path());const replacement=join(directory,'raced-epoch');
  await writeFile(replacement,saved,{mode:0o600});
  const result=await raceOpenedFile(path(),async attempt=>{if(attempt===1)await rename(replacement,path());},async()=>{
   await expect(acquireLocalStoreAuthority(directory,'dev')).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
  });
  expect(result.attempts).toBeGreaterThan(0);for(const handle of result.handles)expect(handle.fd).toBe(-1);
 });
 it('exists before ready host publication and remains stable across fresh reads and explicit repeat registration',async()=>{
  const manifest=await readLocalHost(directory,'dev');
  const first=await acquireLocalStoreAuthority(directory,'dev');
  expect(first.ownerId).toBe(manifest.ownerId);expect(first.datasetId).toBe(manifest.datasetId);
  expect(first.storeEpoch).toMatch(/^[a-f0-9-]{36}$/);expect(first.storeEpoch).not.toBe(manifest.datasetId);
  await first.revalidate();
  expect((await acquireLocalStoreAuthority(directory,'dev')).storeEpoch).toBe(first.storeEpoch);
  expect(await initializeLocalStoreEpoch(directory,'dev')).toBe(first.storeEpoch);
  expect(await readLocalHost(directory,'dev')).toEqual(manifest);
 });
 it('never creates an epoch during a normal read; explicit initialization preserves user host identity',async()=>{
  const before=await readLocalHost(directory,'dev'),saved=await readFile(path());await unlink(path());
  try {
   await expect(acquireLocalStoreAuthority(directory,'dev')).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
   await expect(readFile(path())).rejects.toMatchObject({code:'ENOENT'});
   const epoch=await initializeLocalStoreEpoch(directory,'dev');expect(epoch).toBe((await acquireLocalStoreAuthority(directory,'dev')).storeEpoch);
   expect(await readLocalHost(directory,'dev')).toEqual(before);
  }finally{await writeFile(path(),saved,{mode:0o600});}
 });
 it.each(['malformed','invalid-utf8','oversize','permissions','owner','dataset','symlink','hardlink'])(
  'rejects %s without repairing it or exposing the stored text',async kind=>{
   const saved=await readFile(path());await unlink(path());const target=join(parent,'linked-'+kind);
   try {
    if(kind==='malformed')await writeFile(path(),'secret-invalid',{mode:0o600});
    if(kind==='invalid-utf8')await writeFile(path(),new Uint8Array([123,255,125]),{mode:0o600});
    if(kind==='oversize')await writeFile(path(),' '.repeat(4097),{mode:0o600});
    if(kind==='permissions'){await writeFile(path(),saved,{mode:0o600});await chmod(path(),0o644);}
    if(kind==='owner'||kind==='dataset'){const record=JSON.parse(saved.toString());record[kind==='owner'?'ownerId':'datasetId']=v7();await writeFile(path(),JSON.stringify(record),{mode:0o600});}
    if(kind==='symlink')await symlink(join(directory,'manifest.json'),path());
    if(kind==='hardlink'){await writeFile(target,saved,{mode:0o600});await link(target,path());}
    await expect(acquireLocalStoreAuthority(directory,'dev')).rejects.toThrow(/^STORE_AUTHORITY_UNAVAILABLE$/);
    await expect(initializeLocalStoreEpoch(directory,'dev')).rejects.toThrow(/^STORE_AUTHORITY_UNAVAILABLE$/);
   }finally{await unlink(path());await writeFile(path(),saved,{mode:0o600});await rm(target,{force:true});}
  });
 it('invalidates an already captured authority on identity replacement, even for identical bytes',async()=>{
  const original=await acquireLocalStoreAuthority(directory,'dev'),saved=await readFile(path());
  const replacement=join(directory,'replacement-epoch');await writeFile(replacement,saved,{mode:0o600});await rename(replacement,path());
  await expect(original.revalidate()).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
  await(await acquireLocalStoreAuthority(directory,'dev')).revalidate();
 });
 it('blocks authority during explicit maintenance, including a previously captured authority',async()=>{
  const host=await validatedHost(directory,'dev'),authority=await acquireLocalStoreAuthority(directory,'dev');
  const lock=join(host.target.parent,`.local-host-${digest(host.target.directory)}.lock`);await writeFile(lock,'',{mode:0o600});
  try{await expect(authority.revalidate()).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');await expect(acquireLocalStoreAuthority(directory,'dev')).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');}
  finally{await unlink(lock);}
  await authority.revalidate();
 });
 it('quarantines all normal host access for any recovery marker without clearing it',async()=>{
  const authority=await acquireLocalStoreAuthority(directory,'dev'),marker=join(directory,'recovery-pending.json');
  await writeFile(marker,'partial crash record',{mode:0o600});
  try{
   await expect(authority.revalidate()).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
   await expect(acquireLocalStoreAuthority(directory,'dev')).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
   await expect(readLocalHost(directory,'dev')).rejects.toThrow('LOCAL_HOST_INVALID');
   await expect(initializeLocalStoreEpoch(directory,'dev')).rejects.toThrow('STORE_AUTHORITY_UNAVAILABLE');
   expect(await readFile(marker,'utf8')).toBe('partial crash record');
  }finally{await unlink(marker);}
 });
});
