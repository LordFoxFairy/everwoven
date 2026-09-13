import {constants, type Stats} from 'node:fs';
import {open, lstat} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {validatedHost, recheckTarget, sameFile, assertEnvironment, type LocalEnvironment, type ValidatedHost} from './storage.js';
import {createVideoBindingRegistry} from '../application/video-binding-registry.js';
import type {VideoBindingRegistry, BindingDirectory} from '../contracts/video-binding-registry.js';
import type {BindingResolver} from '../contracts/provider-binding.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {parseOwner} from '../contracts/story-draft-validation.js';

const MAX_CONFIG_BYTES = 65536;
function checkFile(s: Stats) {
  if (!s.isFile() || !process.getuid || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.nlink !== 1 ||
    s.size < 2 || s.size > MAX_CONFIG_BYTES) throw Error('PROVIDER_CONFIGURATION_UNAVAILABLE');
}
/** One descriptor and bounded read; never chmod, follow symlinks or read secret values. */
async function load(host: ValidatedHost): Promise<VideoBindingRegistry> {
  const path = join(host.target.directory, 'providers.json');
  await recheckTarget(host.target, host.identity);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(error => {if (error.code === 'ENOENT') return null; throw error;});
  if (!handle) {
    // Distinguish a truly absent final file from a dangling link or missing/replaced parent.
    if (await lstat(path).catch(error => {if (error.code === 'ENOENT') return null; throw error;})) throw Error();
    await recheckTarget(host.target, host.identity);
    return createVideoBindingRegistry({schemaVersion: 1, connections: [], bindings: []});
  }
  try {
    const before = await handle.stat(); checkFile(before);
    const buffer = new Uint8Array(MAX_CONFIG_BYTES + 1);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat(); checkFile(after);
    if (bytesRead !== before.size || !sameFile(before, after) || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || !sameFile(await lstat(path), before)) throw Error();
    await recheckTarget(host.target, host.identity);
    return createVideoBindingRegistry(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, bytesRead))));
  } finally {await handle.close();}
}
type Snapshot = {key: string; owner: InternalOwnerContext | null; registry: VideoBindingRegistry | null};
function hostKey(directory: string, environment: LocalEnvironment) {
  assertEnvironment(environment);
  if (!isAbsolute(directory)) throw Error('PROVIDER_CONFIGURATION_UNAVAILABLE');
  return `${resolve(directory)}\0${environment}`;
}
/** One instance per launcher process. Factory exists for isolated hosts/tests, not HTTP configuration. */
export function createLocalProviderStartup() {
  let key: string | undefined, initializing: Promise<void> | undefined, snapshot: Snapshot | undefined;
  return {
    initialize(directory: string, environment: LocalEnvironment): Promise<void> {
      const requested = hostKey(directory, environment);
      if (key !== undefined && key !== requested) return Promise.reject(Error('PROVIDER_STARTUP_CONFLICT'));
      if (initializing) return initializing;
      key = requested;
      initializing = (async () => {
        let owner: InternalOwnerContext | null = null;
        try {
          const host = await validatedHost(directory, environment);
          owner = {ownerId: host.manifest.ownerId, datasetId: host.manifest.datasetId};
          const registry = await load(host);
          // Pin manifest identity too; a restored dataset must not inherit another startup's account selection.
          const current = await validatedHost(directory, environment);
          if (!sameFile(current.identity, host.identity) || current.manifest.ownerId !== owner.ownerId || current.manifest.datasetId !== owner.datasetId)
            throw Error();
          snapshot = {key: requested, owner, registry};
        } catch { snapshot = {key: requested, owner, registry: null}; }
      })();
      return initializing;
    },
    access(directory: string, environment: LocalEnvironment, owner: InternalOwnerContext): {
      directory(): BindingDirectory; resolver: BindingResolver;
    } {
      parseOwner(owner);
      const requested = hostKey(directory, environment), captured = {...owner};
      const selected = snapshot?.key === requested && snapshot.owner?.ownerId === captured.ownerId && snapshot.owner.datasetId === captured.datasetId ? snapshot.registry : null;
      const status = !snapshot ? 'not_initialized' : !selected ? 'unavailable' : selected.list().length ? 'ready' : 'empty';
      return {
        directory: () => ({protocolVersion: 1, datasetId: captured.datasetId, status, items: selected?.list() ?? []}),
        resolver: {resolve(context, selection) {
          parseOwner(context);
          if (context.ownerId !== captured.ownerId || context.datasetId !== captured.datasetId) throw Error('OWNER_UNAVAILABLE');
          if (!selected) throw Error(status === 'not_initialized' ? 'PROVIDER_NOT_INITIALIZED' : 'PROVIDER_CONFIGURATION_UNAVAILABLE');
          return selected.resolve(context, selection);
        }},
      };
    },
  };
}
export const localProviderStartup = createLocalProviderStartup();
