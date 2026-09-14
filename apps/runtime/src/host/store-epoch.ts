import {constants, type Stats} from 'node:fs';
import {open, lstat, type FileHandle} from 'node:fs/promises';
import {join} from 'node:path';
import {v7} from 'uuid';
import {isBusinessId, isTimestamp} from '../contracts/primitives.js';
import {openRuntimeDatabase} from '../infrastructure/db/client.js';
import {validatedHost, checkedFile, sameFile, recheckTarget, writeExclusive, unlinkOwned, digest,
  type LocalEnvironment, type ValidatedHost} from './storage.js';

const code = 'STORE_AUTHORITY_UNAVAILABLE';
type EpochRecord = {version: 1; ownerId: string; datasetId: string; storeEpoch: string; createdAt: string};
export type LocalStoreAuthority = Readonly<{ownerId: string; datasetId: string; storeEpoch: string; revalidate(): Promise<void>}>;
const lockPath = (host: ValidatedHost) => join(host.target.parent, `.local-host-${digest(host.target.directory)}.lock`);
const epochPath = (host: ValidatedHost) => join(host.target.directory, 'store-epoch.json');
async function absent(path: string) {
  if (await lstat(path).catch(error => {if (error.code === 'ENOENT') return null; throw error;})) throw Error(code);
}
function metadata(s: Stats) {
  if (!s.isFile() || !process.getuid || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.nlink !== 1 || s.size < 2 || s.size > 4096) throw Error(code);
}
function parseRecord(raw: unknown, host: ValidatedHost): EpochRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(code);
  const r = raw as Record<string,unknown>, keys = ['version','ownerId','datasetId','storeEpoch','createdAt'];
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r,k)) || r.version !== 1 ||
    r.ownerId !== host.manifest.ownerId || r.datasetId !== host.manifest.datasetId || !isBusinessId(r.storeEpoch) ||
    r.storeEpoch === r.ownerId || r.storeEpoch === r.datasetId || !isTimestamp(r.createdAt) ||
    Date.parse(r.createdAt) < Date.parse(host.manifest.createdAt)) throw Error(code);
  return {version:1,ownerId:r.ownerId as string,datasetId:r.datasetId as string,storeEpoch:r.storeEpoch,createdAt:r.createdAt};
}
async function readEpoch(host: ValidatedHost) {
  await recheckTarget(host.target,host.identity);
  await absent(join(host.target.directory,'recovery-pending.json'));
  const path=epochPath(host), handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat(); metadata(before);
    const bytes=new Uint8Array(4097), read=await handle.read(bytes,0,bytes.length,0);
    const after=await handle.stat(); metadata(after);
    if(read.bytesRead!==before.size || !sameFile(before,after) || after.size!==before.size || after.mtimeMs!==before.mtimeMs ||
      after.ctimeMs!==before.ctimeMs || !sameFile(await lstat(path),before)) throw Error(code);
    const record=parseRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,read.bytesRead))),host);
    await recheckTarget(host.target,host.identity);
    await absent(join(host.target.directory,'recovery-pending.json'));
    return {record,identity:before};
  } finally {await handle.close();}
}
async function syncDirectory(host: ValidatedHost) {
  const handle=await open(host.target.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try {if(!sameFile(await handle.stat(),host.identity))throw Error(code);await handle.sync();await recheckTarget(host.target,host.identity);}
  finally{await handle.close();}
}
/** Only initializer/offline maintenance callers, while owning the existing host maintenance lock. */
export async function createInitialStoreEpoch(host: ValidatedHost): Promise<string> {
  let created:Stats|undefined;
  try {
    await recheckTarget(host.target,host.identity);await absent(join(host.target.directory,'recovery-pending.json'));
    const record:EpochRecord={version:1,ownerId:host.manifest.ownerId,datasetId:host.manifest.datasetId,storeEpoch:v7(),
      createdAt:new Date(Math.max(Date.now(),Date.parse(host.manifest.createdAt))).toISOString()};
    created=await writeExclusive(epochPath(host),JSON.stringify(record));
    await syncDirectory(host);
    const read=await readEpoch(host);
    if(!sameFile(read.identity,created) || JSON.stringify(read.record)!==JSON.stringify(record)) throw Error(code);
    return record.storeEpoch;
  }catch{if(created)await unlinkOwned(epochPath(host),created).catch(()=>{});throw Error(code);}
}
/** Explicit offline registration; never called by an HTTP request or ordinary startup. */
export async function initializeLocalStoreEpoch(directory:string,environment:LocalEnvironment):Promise<string>{
  let lock:FileHandle|undefined,identity:Stats|undefined,path:string|undefined;
  try{
    const host=await validatedHost(directory,environment);path=lockPath(host);
    lock=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    identity=await lock.stat();
    if(!identity.isFile()||identity.nlink!==1||!process.getuid||identity.uid!==process.getuid()||(identity.mode&0o777)!==0o600)throw Error(code);
    const fresh=await validatedHost(directory,environment);
    if(!sameFile(fresh.identity,host.identity)||JSON.stringify(fresh.manifest)!==JSON.stringify(host.manifest))throw Error(code);
    const db=await openRuntimeDatabase(join(host.target.directory,'runtime.db'));
    try{if(!await db.localProfile.findFirst({where:{id:host.manifest.ownerId,deletedAt:null},select:{id:true}}))throw Error(code);}
    finally{await db.$disconnect();}
    // An existing malformed, linked or partial record is never repaired or replaced.
    if(await lstat(epochPath(host)).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))return(await readEpoch(host)).record.storeEpoch;
    return await createInitialStoreEpoch(host);
  }catch{throw Error(code);}
  finally{if(lock){try{if(path&&identity)await unlinkOwned(path,identity);}finally{await lock.close();}}}
}
/** Read-only authority. Normal restart never invents an epoch; maintenance/recovery invalidates captures. */
export async function acquireLocalStoreAuthority(directory:string,environment:LocalEnvironment):Promise<LocalStoreAuthority>{
  try{
    const host=await validatedHost(directory,environment);await absent(lockPath(host));
    const manifestIdentity=await checkedFile(join(host.target.directory,'manifest.json'));
    const {record,identity}=await readEpoch(host);
    const revalidate=async()=>{
      try{
        await absent(lockPath(host));
        const fresh=await validatedHost(directory,environment);
        if(!sameFile(fresh.identity,host.identity)||JSON.stringify(fresh.manifest)!==JSON.stringify(host.manifest)||
          !sameFile(await checkedFile(join(host.target.directory,'manifest.json')),manifestIdentity))throw Error(code);
        const current=await readEpoch(host);
        if(!sameFile(current.identity,identity)||JSON.stringify(current.record)!==JSON.stringify(record))throw Error(code);
        await absent(lockPath(host));
      }catch{throw Error(code);}
    };
    await revalidate();
    return Object.freeze({ownerId:record.ownerId,datasetId:record.datasetId,storeEpoch:record.storeEpoch,revalidate});
  }catch{throw Error(code);}
}
