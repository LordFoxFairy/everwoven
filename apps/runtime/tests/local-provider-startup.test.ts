import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {mkdtemp, chmod, writeFile, unlink, symlink, link, mkdir, rm, realpath, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {v7} from 'uuid';
import {createLocalProviderStartup} from '../src/host/provider-startup.js';
import * as host from '../src/host/index.js';
import {raceOpenedFile} from './local-host-races.js';
let parent: string, directory: string, path: string, owner: {ownerId: string; datasetId: string};
const configuration = () => ({schemaVersion: 1,
  connections: [{id: 'personal', providerId: 'minimax', region: 'international', accountScopeId: 'account-one', credentialRef: 'env:MINIMAX_API_KEY'}],
  bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'personal', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}],
});
beforeAll(async () => {
  parent = await mkdtemp(join(await realpath(tmpdir()), 'provider-startup-'));
  directory = join(parent, 'host'); path = join(directory, 'providers.json');
  const manifest = await host.initializeLocalHost(directory, 'dev');
  owner = {ownerId: manifest.ownerId, datasetId: manifest.datasetId};
});
afterEach(async () => {await rm(path, {recursive: true, force: true});});
afterAll(async () => {await rm(parent, {recursive: true, force: true});});
async function write(value = configuration()) {await writeFile(path, JSON.stringify(value), {mode: 0o600});}
describe('one-time private host provider snapshot', () => {
  it('does not load from requests or manufacture a default connection', async () => {
    const startup = createLocalProviderStartup();
    expect(startup.access(directory, 'dev', owner).directory()).toMatchObject({status: 'not_initialized', items: []});
    await startup.initialize(directory, 'dev');
    expect(startup.access(directory, 'dev', owner).directory()).toMatchObject({status: 'empty', items: []});
    await write(); await startup.initialize(directory, 'dev');
    expect(startup.access(directory, 'dev', owner).directory().status).toBe('empty');
    const restarted = createLocalProviderStartup(); await restarted.initialize(directory, 'dev');
    expect(restarted.access(directory, 'dev', owner).directory().status).toBe('ready');
  });
  it('pins nested config once, ignores later removal and checks host dataset identity', async () => {
    await write(); const startup = createLocalProviderStartup();
    await Promise.all([startup.initialize(directory, 'dev'), startup.initialize(directory, 'dev')]);
    const access = startup.access(directory, 'dev', owner), first = access.resolver.resolve(owner, {bindingKey: 'video', versionNo: 1});
    await unlink(path);
    expect(access.resolver.resolve(owner, {bindingKey: 'video', versionNo: 1})).toEqual(first);
    expect(JSON.stringify(access.directory())).not.toMatch(/credentialRef|account-one|api.minimax|MINIMAX_API_KEY/);
    const changedOwner = {...owner, datasetId: v7()}, mismatched = startup.access(directory, 'dev', changedOwner);
    expect(mismatched.directory()).toMatchObject({status: 'unavailable', items: []});
    expect(() => mismatched.resolver.resolve(changedOwner, {bindingKey: 'video', versionNo: 1})).toThrow('PROVIDER_CONFIGURATION_UNAVAILABLE');
    await expect(startup.initialize(join(parent, 'another'), 'dev')).rejects.toThrow('PROVIDER_STARTUP_CONFLICT');
  });
  it.each(['malformed', 'invalid-utf8', 'oversize', 'permissions', 'symlink', 'dangling', 'hardlink', 'directory'])(
    'rejects %s without repairing the file or leaking diagnostics', async kind => {
      if (kind === 'malformed') await writeFile(path, '{broken', {mode: 0o600});
      if (kind === 'invalid-utf8') await writeFile(path, new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]), {mode: 0o600});
      if (kind === 'oversize') await writeFile(path, ' '.repeat(65537), {mode: 0o600});
      if (kind === 'permissions') {await write(); await chmod(path, 0o644);}
      if (kind === 'symlink') await symlink(join(directory, 'manifest.json'), path);
      if (kind === 'dangling') await symlink(join(directory, 'missing'), path);
      if (kind === 'hardlink') {const target = join(parent, 'config-link'); await writeFile(target, JSON.stringify(configuration()), {mode: 0o600}); await link(target, path);}
      if (kind === 'directory') await mkdir(path, {mode: 0o700});
      const startup = createLocalProviderStartup(); await startup.initialize(directory, 'dev');
      const access = startup.access(directory, 'dev', owner);
      expect(access.directory()).toEqual({protocolVersion: 1, datasetId: owner.datasetId, status: 'unavailable', items: []});
      expect(() => access.resolver.resolve(owner, {bindingKey: 'video', versionNo: 1})).toThrow(/^PROVIDER_CONFIGURATION_UNAVAILABLE$/);
    },
  );
  it('enforces captured authenticated context even when resolve is called with another owner', async () => {
    await write(); const startup = createLocalProviderStartup(); await startup.initialize(directory, 'dev');
    const access = startup.access(directory, 'dev', owner);
    expect(() => access.resolver.resolve({...owner, ownerId: v7()}, {bindingKey: 'video', versionNo: 1})).toThrow('OWNER_UNAVAILABLE');
  });
  it.each(['replace', 'grow'] as const)('rejects a deterministic %s during the real descriptor read', async kind => {
    await write(); const startup = createLocalProviderStartup();
    const raced = await raceOpenedFile(path, async attempt => {
      if (attempt !== 1) return;
      if (kind === 'replace') {await rename(path, join(parent, 'replaced-config')); await write();}
      else await writeFile(path, ' '.repeat(65537));
    }, () => startup.initialize(directory, 'dev'));
    expect(raced.attempts).toBeGreaterThan(0);
    expect(startup.access(directory, 'dev', owner).directory().status).toBe('unavailable');
    expect(raced.handles.every(handle => handle.fd === -1)).toBe(true);
  });
  it('exposes authenticated openings through the original host boundary', async () => {
    await write();
    const token = (await host.exchangeConnectionCode(directory, 'dev', await host.issueConnectionCode(directory, 'dev'))).token;
    await expect(host.withLocalExperienceOpenings(directory, 'dev', 'invalid', async s => s.bindings())).rejects.toThrow();
    await host.initializeLocalVideoProviders(directory, 'dev');
    const input = {protocolVersion: 1 as const, datasetId: owner.datasetId, commandId: v7(), title: 'test',
      settings: {world: 'world', opening: 'opening', genre: '', playerRole: '', worldRules: [], tone: ''}, mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}};
    const draft = await host.withLocalStories(directory, 'dev', token, (s, o) => s.create(o, input));
    const command = {protocolVersion: 1 as const, datasetId: owner.datasetId, commandId: v7(), storyDraftId: draft.data.id, expectedStoryRevision: 1,
      bindingKey: 'video', expectedBindingVersion: 1, budget: {limitMicros: '0', currency: 'USD' as const}};
    const result = await host.withLocalExperienceOpenings(directory, 'dev', token, async (s, o) => {
      expect(s.bindings()).toMatchObject({status: 'ready', datasetId: owner.datasetId});
      return s.create(o, command);
    });
    await unlink(path);
    expect(await host.withLocalExperienceOpenings(directory, 'dev', token, (s, o) => s.create(o, command))).toEqual({...result, replayed: true});
    expect(await host.withLocalExperienceOpenings(directory, 'dev', token, (s, o) => s.getPreparing(o, {
      protocolVersion: 1, datasetId: owner.datasetId, id: result.data.id,
    }))).toEqual(result.data);
  });
});
