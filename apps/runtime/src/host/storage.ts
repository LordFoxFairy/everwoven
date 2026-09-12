import {constants, type Stats} from 'node:fs';
import {lstat, mkdir, open, realpath, unlink, type FileHandle} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, parse, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {v7} from 'uuid';
import {openRuntimeDatabase} from '../infrastructure/db/client.js';

export type LocalEnvironment = 'dev' | 'prod';
export type HostManifest = {version: 1; ownerId: string; datasetId: string; environment: LocalEnvironment; createdAt: string};
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uid = () => {if (!process.getuid) throw new Error('LOCAL_HOST_INVALID'); return process.getuid();};
export function assertEnvironment(value: unknown): asserts value is LocalEnvironment {
  if (value !== 'dev' && value !== 'prod') throw new Error('LOCAL_HOST_INVALID');
}
export function sameFile(a: Stats, b: Stats) {return a.dev === b.dev && a.ino === b.ino;}
function checkFileMetadata(s: Stats) {
  if (!s.isFile() || s.uid !== uid() || (s.mode & 0o777) !== 0o600) throw new Error('LOCAL_HOST_INVALID');
}
function checkFile(s: Stats) {
  checkFileMetadata(s);
  if (s.nlink !== 1) throw new Error('LOCAL_HOST_INVALID');
}
export async function checkedDirectory(path: string, privateDirectory = true): Promise<Stats> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const s = await handle.stat();
    if (!s.isDirectory() || s.uid !== uid() || (privateDirectory ? (s.mode & 0o777) !== 0o700 : (s.mode & 0o022) !== 0)) throw new Error('LOCAL_HOST_INVALID');
    return s;
  } finally {await handle.close();}
}
export async function checkedFile(path: string): Promise<Stats> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {const s = await handle.stat(); checkFile(s); return s;} finally {await handle.close();}
}
/** Only optional SQLite sidecars may disappear when the last database connection closes. */
async function checkedOptionalSidecar(path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      .catch(error => {if (error.code === 'ENOENT') return null; throw error;});
    if (!handle) return;
    try {
      const s = await handle.stat();
      checkFileMetadata(s); // Unlinked descriptors must still have the expected type/owner/mode.
      if (s.nlink === 1) return;
      if (s.nlink !== 0) throw new Error('LOCAL_HOST_INVALID');
      // nlink=0 is not a hard link. Confirm absence; otherwise inspect and reopen the replacement.
      const current = await lstat(path).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
      if (!current) return;
      checkFileMetadata(current); // lstat rejects symlinks, including dangling ones, without following.
      if (current.nlink !== 0 && current.nlink !== 1) throw new Error('LOCAL_HOST_INVALID');
    } finally {await handle.close();}
  }
  // Repeated replacement is not evidence of absence or a stable, checked descriptor. Fail closed.
  throw new Error('LOCAL_HOST_INVALID');
}
export async function readSecureJSON(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await handle.stat(); checkFile(s);
    if (s.size < 2 || s.size > 4096) throw new Error('LOCAL_HOST_INVALID');
    const buffer = Buffer.alloc(4097), {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== s.size) throw new Error('LOCAL_HOST_INVALID');
    checkFile(await handle.stat());
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {await handle.close();}
}
/** Only unlink a file whose inode we created/opened; never recursively clean a target. */
export async function unlinkOwned(path: string, identity: Stats) {
  const current = await lstat(path).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
  if (current && sameFile(current, identity)) await unlink(path);
}
export async function writeExclusive(path: string, value: string): Promise<Stats> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const identity = await handle.stat();
  try {checkFile(identity); await handle.writeFile(value, 'utf8'); await handle.sync(); return identity;}
  catch (error) {await unlinkOwned(path, identity); throw error;}
  finally {await handle.close();}
}
export function record(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('LOCAL_HOST_INVALID');
}
function parseManifest(value: unknown, environment: LocalEnvironment): HostManifest {
  record(value, ['version', 'ownerId', 'datasetId', 'environment', 'createdAt']);
  if (value.version !== 1 || value.environment !== environment || typeof value.ownerId !== 'string' || !uuid7.test(value.ownerId) ||
      typeof value.datasetId !== 'string' || !uuid7.test(value.datasetId) || value.datasetId === value.ownerId ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) throw new Error('LOCAL_HOST_INVALID');
  return {version: 1, ownerId: value.ownerId, datasetId: value.datasetId, environment, createdAt: value.createdAt};
}
export type Target = {directory: string; parent: string; parentIdentity: Stats};
export async function targetDirectory(directory: string, environment: LocalEnvironment): Promise<Target> {
  assertEnvironment(environment);
  if (typeof directory !== 'string' || !isAbsolute(directory) || /[\0\r\n?#%]/.test(directory) || directory.split(sep).some(part => part === '.' || part === '..')) throw new Error('LOCAL_HOST_INVALID');
  // Canonicalize only the OS temporary-root alias, before entering the trusted parent.
  const temporary = tmpdir().replace(/\/$/, ''), canonicalTemporary = await realpath(temporary);
  if (directory.startsWith(`${temporary}/`)) directory = canonicalTemporary + directory.slice(temporary.length);
  directory = resolve(directory);
  if (directory === parse(directory).root) throw new Error('LOCAL_HOST_INVALID');
  const parent = dirname(directory);
  let component = parse(parent).root;
  for (const part of parent.slice(component.length).split(sep).filter(Boolean)) {
    component = join(component, part);
    const s = await lstat(component);
    if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('LOCAL_HOST_INVALID');
  }
  return {directory, parent, parentIdentity: await checkedDirectory(parent, false)};
}
export async function recheckTarget(target: Target, identity?: Stats) {
  const fresh = await targetDirectory(target.directory, 'dev');
  if (!sameFile(fresh.parentIdentity, target.parentIdentity)) throw new Error('LOCAL_HOST_INVALID');
  if (identity && !sameFile(await checkedDirectory(target.directory), identity)) throw new Error('LOCAL_HOST_INVALID');
}
export type ValidatedHost = {target: Target; identity: Stats; manifest: HostManifest};
export async function validatedHost(directory: string, environment: LocalEnvironment): Promise<ValidatedHost> {
  const target = await targetDirectory(directory, environment), identity = await checkedDirectory(target.directory);
  const manifest = parseManifest(await readSecureJSON(join(target.directory, 'manifest.json')), environment);
  await checkedFile(join(target.directory, 'runtime.db'));
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await checkedOptionalSidecar(join(target.directory, `runtime.db${suffix}`));
  }
  for (const name of ['security', 'security/codes', 'security/sessions', 'security/claims']) await checkedDirectory(join(target.directory, name));
  await recheckTarget(target, identity);
  return {target, identity, manifest};
}
export async function readLocalHost(directory: string, environment: LocalEnvironment): Promise<HostManifest> {
  try {return (await validatedHost(directory, environment)).manifest;} catch {throw new Error('LOCAL_HOST_INVALID');}
}

const exec = promisify(execFile);
const runtimeRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function migrateDatabase(path: string): Promise<void> {
  // Repository-controlled executable/config; argument vector only, no shell or user-provided URL.
  await exec(process.execPath, [join(runtimeRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', join(runtimeRoot, 'prisma.config.ts')], {
    cwd: runtimeRoot, env: {...process.env, RUNTIME_DATABASE_URL: `file:${path}`},
    timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
}
/** Internal dependencies are not exported by the host entry point or accepted from HTTP/CLI. */
export type InitializationOptions = {
  migrate?: (path: string) => Promise<void>;
  beforeReserve?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
};
export async function initializeHost(directory: string, environment: LocalEnvironment, options: InitializationOptions = {}): Promise<HostManifest> {
  let lock: FileHandle | undefined, lockIdentity: Stats | undefined, lockPath: string | undefined;
  let publication: {path: string; identity: Stats} | undefined;
  try {
    const target = await targetDirectory(directory, environment);
    lockPath = join(target.parent, `.local-host-${digest(target.directory)}.lock`);
    lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    lockIdentity = await lock.stat(); checkFile(lockIdentity);
    await recheckTarget(target);
    const exists = await lstat(target.directory).then(() => true, error => {if (error.code === 'ENOENT') return false; throw error;});
    if (exists) return await readLocalHost(target.directory, environment);
    await options.beforeReserve?.(); await recheckTarget(target);
    // mkdir is the no-replace reservation. No rename-over-target, recursive mkdir or cleanup.
    await mkdir(target.directory, {mode: 0o700});
    const identity = await checkedDirectory(target.directory);
    await recheckTarget(target, identity);
    for (const name of ['security', 'security/codes', 'security/sessions', 'security/claims']) {
      await mkdir(join(target.directory, name), {mode: 0o700}); await recheckTarget(target, identity);
    }
    const databasePath = join(target.directory, 'runtime.db');
    await writeExclusive(databasePath, '');
    await (options.migrate ?? migrateDatabase)(databasePath);
    await recheckTarget(target, identity); await checkedFile(databasePath);
    const manifest: HostManifest = {version: 1, ownerId: v7(), datasetId: v7(), environment, createdAt: new Date().toISOString()};
    const db = await openRuntimeDatabase(databasePath);
    try {
      if (await db.localProfile.count() !== 0) throw new Error('LOCAL_HOST_INVALID');
      const now = new Date(manifest.createdAt);
      await db.localProfile.create({data: {id: manifest.ownerId, displayName: 'Local owner', createdAt: now, updatedAt: now}});
    } finally {await db.$disconnect();}
    await options.beforePublish?.();
    await recheckTarget(target, identity); await checkedFile(databasePath);
    for (const name of ['security', 'security/codes', 'security/sessions', 'security/claims']) await checkedDirectory(join(target.directory, name));
    const manifestPath = join(target.directory, 'manifest.json');
    const published = await writeExclusive(manifestPath, JSON.stringify(manifest));
    publication = {path: manifestPath, identity: published};
    try {await recheckTarget(target, identity);} catch (error) {await unlinkOwned(manifestPath, published); throw error;}
    return manifest;
  } catch {throw new Error('LOCAL_HOST_INVALID');}
  finally {
    if (lock) {
      try {
        if (lockPath && lockIdentity) await unlinkOwned(lockPath, lockIdentity);
        await lock.close();
      } catch {
        // A failed initializer must not leave its own ready marker, even on lock-release failure.
        if (publication) await unlinkOwned(publication.path, publication.identity).catch(() => {});
        throw new Error('LOCAL_HOST_INVALID');
      } finally {await lock.close().catch(() => {});}
    }
  }
}
export async function initializeLocalHost(directory: string, environment: LocalEnvironment): Promise<HostManifest> {
  return initializeHost(directory, environment);
}
