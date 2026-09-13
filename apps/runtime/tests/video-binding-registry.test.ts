import {describe, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {createVideoBindingRegistry} from '../src/application/video-binding-registry.js';
import {checkVideoCompatibility} from '../src/providers/minimax-capabilities.js';
const owner = {ownerId: v7(), datasetId: v7()};
function config() { return {schemaVersion: 1, connections: [
  {id: 'official-cn', providerId: 'minimax', region: 'cn', accountScopeId: 'personal-cn', credentialRef: 'env:MINIMAX_CN_KEY'},
  {id: 'official-int', providerId: 'minimax', region: 'international', accountScopeId: 'personal-int', credentialRef: 'env:MINIMAX_INT_KEY'},
], bindings: [
  {bindingKey: 'video-cn', versionNo: 1, connectionId: 'official-cn', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}},
  {bindingKey: 'video-int', versionNo: 1, connectionId: 'official-int', catalogId: 'minimax-h3', operationKind: 'image-to-video', generation: {duration: 4, resolution: '2K', ratio: 'adaptive'}},
]}; }
function resolve(c = config(), key = 'video-cn') { return createVideoBindingRegistry(c).resolve(owner, {bindingKey: key, versionNo: 1}); }
describe('single authoritative video binding registry', () => {
  it('resolves exact supplier, region, account and deployment with no key/network access', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('NO_NETWORK'));
    try {
      const registry = createVideoBindingRegistry(config());
      const cn = registry.resolve(owner, {bindingKey: 'video-cn', versionNo: 1});
      const international = registry.resolve(owner, {bindingKey: 'video-int', versionNo: 1});
      expect(cn).toMatchObject({ownerId: owner.ownerId, providerId: 'minimax', modelId: 'MiniMax-H3-Max', mode: 'job',
        parameters: {region: 'cn', endpointProfileId: 'minimax-cn-v2', providerAccountScopeId: 'personal-cn'}});
      expect(international).toMatchObject({modelId: 'MiniMax-H3', parameters: {region: 'international', endpointProfileId: 'minimax-international-v2', providerAccountScopeId: 'personal-int'}});
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(JSON.stringify(list)).not.toMatch(/credentialRef|accountScopeId|personal-cn|https:|MINIMAX_CN_KEY/);
      expect(list[0]).toMatchObject({bindingKey: 'video-cn', versionNo: 1, canPrepare: true, canDispatch: false, accountVerification: 'unknown'});
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('detaches original configuration, output and selection from the registry', () => {
    const c = config(), registry = createVideoBindingRegistry(c);
    const a = registry.resolve(owner, {bindingKey: 'video-cn', versionNo: 1});
    c.connections[0]!.accountScopeId = 'changed';
    c.bindings[0]!.generation.resolution = '480P';
    a.parameters.generation.duration = 15;
    const b = registry.resolve(owner, {bindingKey: 'video-cn', versionNo: 1});
    expect(b.parameters).toMatchObject({providerAccountScopeId: 'personal-cn', generation: {duration: 5, resolution: '768P'}});
    const list = registry.list(); list[0]!.modelId = 'tampered';
    expect(registry.list()[0]!.modelId).toBe('MiniMax-H3-Max');
  });
  it('uses exact version, no hidden default, and an empty explicit registry is valid', () => {
    expect(createVideoBindingRegistry({schemaVersion: 1, connections: [], bindings: []}).list()).toEqual([]);
    const registry = createVideoBindingRegistry(config());
    for (const selection of [{bindingKey: 'missing', versionNo: 1}, {bindingKey: 'video-cn', versionNo: 2}])
      expect(() => registry.resolve(owner, selection)).toThrow('PROVIDER_BINDING_NOT_REGISTERED');
  });
  it.each(['region', 'provider', 'endpoint', 'secret', 'connection-duplicate', 'binding-duplicate', 'missing-connection', 'model', 'reference', 'bad-spec', 'raw-credential'])(
    'rejects malformed or unsupported configuration: %s', kind => {
      const c = config();
      if (kind === 'region') c.connections[0]!.region = 'us';
      if (kind === 'provider') c.connections[0]!.providerId = 'fal';
      if (kind === 'endpoint') Object.assign(c.connections[0]!, {baseUrl: 'https://untrusted.invalid'});
      if (kind === 'secret') Object.assign(c.connections[0]!, {apiKey: 'secret'});
      if (kind === 'connection-duplicate') c.connections.push({...c.connections[0]!});
      if (kind === 'binding-duplicate') c.bindings.push({...c.bindings[0]!});
      if (kind === 'missing-connection') c.bindings[0]!.connectionId = 'missing';
      if (kind === 'model') c.bindings[0]!.catalogId = 'h3-max-director';
      if (kind === 'reference') c.bindings[0]!.operationKind = 'reference-to-video';
      if (kind === 'bad-spec') c.bindings[0]!.generation.resolution = '2K';
      if (kind === 'raw-credential') c.connections[0]!.credentialRef = 'sk-raw-secret';
      expect(() => createVideoBindingRegistry(c)).toThrow('INVALID_VIDEO_REGISTRY');
    },
  );
  it('permits two actual versions without conflating display labels or accounts', () => {
    const c = config(); c.bindings.push({...c.bindings[0]!, versionNo: 2});
    expect(createVideoBindingRegistry(c).list()).toHaveLength(3);
  });
  it('rejects hidden credential/model/URL overrides in effective generation', () => {
    for (const key of ['baseUrl', 'model', 'apiKey']) {
      const c = config(); Object.assign(c.bindings[0]!.generation, {[key]: 'bad'});
      expect(() => createVideoBindingRegistry(c)).toThrow('INVALID_VIDEO_REGISTRY');
    }
  });
  it('rejects non-JSON configuration without executing getters and isolates successive owner calls', () => {
    let reads = 0; const c = config();
    Object.defineProperty(c.connections[0]!, 'region', {get() { reads++; return 'cn'; }, enumerable: true});
    expect(() => createVideoBindingRegistry(c)).toThrow('INVALID_VIDEO_REGISTRY'); expect(reads).toBe(0);
    const registry = createVideoBindingRegistry(config()), other = {...owner, ownerId: v7()};
    expect(registry.resolve(other, {bindingKey: 'video-cn', versionNo: 1}).ownerId).toBe(other.ownerId);
    expect(registry.resolve(owner, {bindingKey: 'video-cn', versionNo: 1}).ownerId).toBe(owner.ownerId);
  });
});
describe('input compatibility is not quote or dispatch permission', () => {
  it('validates t2v input but does not manufacture account or execution readiness', () => {
    expect(checkVideoCompatibility(resolve(), {prompt: '回应玩家', images: []})).toEqual({compatible: true, requiresImageTransport: false, accountVerification: 'unknown', canDispatch: false});
  });
  const img = () => ({assetId: v7(), role: 'first_frame', mimeType: 'image/webp', width: 1280, height: 720, byteSize: '1024'});
  it('validates i2v dimensions/bytes/roles, with image-defined ratio', () => {
    const spec = resolve(config(), 'video-int');
    expect(checkVideoCompatibility(spec, {prompt: '回应玩家', images: [img()]})).toMatchObject({compatible: true, requiresImageTransport: true, canDispatch: false});
    expect(checkVideoCompatibility(spec, {prompt: '回应玩家', images: [{...img(), role: 'last_frame'}]})).toMatchObject({compatible: true});
  });
  it.each(['empty', 'long', 't2v-image', 'i2v-missing', 'duplicate-role', 'too-small', 'too-large', 'aspect', 'bytes', 'mime', 'reference', 'opaque', 'forged-capability', 'model', 'endpoint', 'version'])(
    'rejects unsupported or inconsistent input: %s', kind => {
      const spec = resolve(config(), 'video-int'), input = {prompt: '回应玩家', images: [img()]};
      if (kind === 'empty') input.prompt = ' ';
      if (kind === 'long') input.prompt = 'x'.repeat(7001);
      if (kind === 't2v-image') spec.parameters.operationKind = 'text-to-video';
      if (kind === 'i2v-missing') input.images = [];
      if (kind === 'duplicate-role') input.images.push(img());
      if (kind === 'too-small') input.images[0]!.width = 255;
      if (kind === 'too-large') input.images[0]!.height = 5761;
      if (kind === 'aspect') input.images[0]!.width = 3000;
      if (kind === 'bytes') input.images[0]!.byteSize = '30000001';
      if (kind === 'mime') input.images[0]!.mimeType = 'image/svg+xml';
      if (kind === 'reference') input.images[0]!.role = 'reference_image';
      if (kind === 'opaque') spec.capabilities = {schemaVersion: 1, evidence: 'unknown'};
      if (kind === 'forged-capability') spec.capabilities = {...spec.capabilities, verified: true};
      if (kind === 'model') spec.modelId = 'MiniMax-H3-Max';
      if (kind === 'endpoint') spec.parameters.endpointProfileId = 'minimax-cn-v2';
      if (kind === 'version') spec.capabilityVersion = 'unknown-version';
      expect(() => checkVideoCompatibility(spec, input)).toThrow('VIDEO_INPUT_INCOMPATIBLE');
    },
  );
});
