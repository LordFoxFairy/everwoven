import {constants, lstatSync, openSync, fstatSync, closeSync, fsyncSync, type Stats} from 'node:fs';
import {lstat, mkdir, open} from 'node:fs/promises';
import {dirname, join, parse, resolve} from 'node:path';
import type {ValidatedHost} from '../../host/storage.js';
import {PrivateAssetError} from '../../ports/private-asset-store.js';
import {runCleanupCheckpoint, type CleanupCheckpoint} from './private-asset-deletion.js';
import type {PrivateAssetFaults} from './private-asset-store.js';

type Identity = {dev: number; ino: number; uid: number; mode: number};
const identity = (s: Stats): Identity => ({dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode});
export const sameInode = (a: Pick<Stats, 'dev' | 'ino'>, b: Pick<Stats, 'dev' | 'ino'>) => a.dev === b.dev && a.ino === b.ino;
const sameIdentity = (a: Identity, b: Identity) => sameInode(a, b) && a.uid === b.uid && a.mode === b.mode;
const uid = () => process.getuid!();
export const hasCode = (error: unknown, code: string) => !!error && typeof error === 'object' && 'code' in error && error.code === code;
function assertDirectory(stat: Stats, isPrivate: boolean): void {
  const writable = (stat.mode & 0o022) !== 0;
  // Sticky shared roots must be owned by root/current UID; each descendant is similarly
  // trusted, so another OS user cannot rename the next component through a sticky parent.
  if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== uid()) ||
      (writable && !(stat.mode & 0o1000)) ||
      (isPrivate && (stat.uid !== uid() || (stat.mode & 0o7777) !== 0o700))) throw Error();
}
/** No openat in portable Node: these checks detect change, not arbitrary same-UID TOCTOU.
 * Cooperative processes NEVER replace host/assets/dataset directories. Reset stops all work. */
export class PrivateAssetDirectories {
  private readonly pinned = new Map<string, Identity>();
  private invalid = false;
  readonly hostPath: string;
  readonly assetsPath: string;
  readonly datasetPath: string;
  private constructor(host: ValidatedHost, datasetId: string, private readonly faults: PrivateAssetFaults) {
    this.hostPath = host.target.directory;
    this.assetsPath = join(this.hostPath, 'assets');
    this.datasetPath = join(this.assetsPath, datasetId);
  }
  static async create(host: ValidatedHost, datasetId: string, faults: PrivateAssetFaults): Promise<PrivateAssetDirectories> {
    const dirs = new PrivateAssetDirectories(host, datasetId, faults);
    // Snapshot the trusted host's identities before any await. Never adopt a replacement baseline.
    const expectedHost = identity(host.identity), expectedParent = identity(host.target.parentIdentity), parent = host.target.parent;
    try {
      if (resolve(dirs.hostPath) !== dirs.hostPath || dirname(dirs.hostPath) !== parent) throw Error();
      const root = parse(dirs.hostPath).root;
      let path = root;
      await dirs.pin(path, false);
      for (const part of dirs.hostPath.slice(root.length).split('/').filter(Boolean)) {
        path = join(path, part); await dirs.pin(path, path === dirs.hostPath);
      }
      if (!sameIdentity(dirs.pinned.get(dirs.hostPath)!, expectedHost) || !sameIdentity(dirs.pinned.get(parent)!, expectedParent)) throw Error();
      await dirs.recheck();
      await dirs.ensurePrivate(dirs.assetsPath, 'assets');
      await dirs.ensurePrivate(dirs.datasetPath, 'dataset');
      return dirs;
    } catch (error) {
      if (error instanceof PrivateAssetError) throw error;
      throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');
    }
  }
  private async checked(path: string, isPrivate: boolean): Promise<Stats> {
    const stat = await lstat(path);
    assertDirectory(stat, isPrivate);
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {if (!sameIdentity(identity(stat), identity(await handle.stat()))) throw Error();} finally {await handle.close();}
    return stat;
  }
  private async pin(path: string, isPrivate: boolean): Promise<void> {
    const stat = await this.checked(path, isPrivate);
    this.pinned.set(path, identity(stat));
  }
  async recheck(): Promise<void> {
    if (this.invalid) throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');
    try {
      for (const [path, before] of this.pinned) {
        const current = await this.checked(path, path === this.hostPath || path === this.assetsPath || path === this.datasetPath);
        if (!sameIdentity(before, identity(current))) throw Error();
      }
    } catch {
      this.invalid = true;
      throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');
    }
  }
  /** Same pinned identities and permission policy as async recheck, with no promise/yield. */
  recheckSync(): void {
    if (this.invalid) throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');
    try {
      for (const [path, before] of this.pinned) {
        const stat = lstatSync(path);
        assertDirectory(stat, path === this.hostPath || path === this.assetsPath || path === this.datasetPath);
        const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {if (!sameIdentity(identity(stat), identity(fstatSync(fd))) || !sameIdentity(before, identity(stat))) throw Error();}
        finally {closeSync(fd);}
      }
    } catch {this.invalid = true; throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');}
  }
  /** Only fixed metadata operations/dir sync. Never calls the asynchronous fault port. */
  syncCleanup(assetId: string, checkpoint?: CleanupCheckpoint): void {
    this.recheckSync(); runCleanupCheckpoint(checkpoint, 'before-directory-sync', assetId); this.recheckSync();
    const fd = openSync(this.datasetPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!sameIdentity(identity(fstatSync(fd)), this.pinned.get(this.datasetPath)!)) {
        this.invalid = true; throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');
      }
      fsyncSync(fd);
    } finally {closeSync(fd);}
    this.recheckSync(); runCleanupCheckpoint(checkpoint, 'after-directory-sync', assetId); this.recheckSync();
  }
  private async ensurePrivate(path: string, label: 'assets' | 'dataset'): Promise<void> {
    await this.recheck();
    let created = false;
    try {await mkdir(path, {mode: 0o700}); created = true;} catch (error) {if (!hasCode(error, 'EEXIST')) throw new PrivateAssetError('PRIVATE_ASSET_IO');}
    await this.pin(path, true);
    if (created) await this.faults.checkpoint?.('after-directory-create', {directory: label});
    await this.recheck();
    // Sync even an existing directory: another cooperative creator may not yet have synced it.
    await this.sync(label);
    await this.sync(label === 'assets' ? 'host' : 'assets');
  }
  async sync(directory: 'host' | 'assets' | 'dataset', assetId?: string): Promise<void> {
    await this.recheck();
    await this.faults.checkpoint?.('before-directory-sync', {directory, assetId});
    await this.recheck();
    const path = directory === 'host' ? this.hostPath : directory === 'assets' ? this.assetsPath : this.datasetPath;
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!sameIdentity(identity(await handle.stat()), this.pinned.get(path)!)) {this.invalid = true; throw new PrivateAssetError('PRIVATE_ASSET_STORE_INVALIDATED');}
      await handle.sync();
    } finally {await handle.close();}
    await this.recheck();
    await this.faults.checkpoint?.('after-directory-sync', {directory, assetId});
    await this.recheck();
  }
}
