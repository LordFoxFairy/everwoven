import {fields, parseOwner, parseRevision} from '../contracts/story-draft-validation.js';
import {bindingLabel, canonicalBindingJson, parseBindingSpec} from '../contracts/provider-binding-validation.js';
import type {BindingSpec} from '../contracts/provider-binding.js';
import type {VideoBindingRegistry, VideoBindingChoice} from '../contracts/video-binding-registry.js';
import {getDeployment} from '../contracts/video-deployments.js';
import {MINIMAX_ADAPTER_VERSION, MINIMAX_CAPABILITY_VERSION, miniMaxRegion, minimaxEndpoints,
  miniMaxCapabilities, validateMiniMaxGeneration} from '../providers/minimax-capabilities.js';
import {POLLO_ADAPTER_VERSION, POLLO_CAPABILITY_VERSION, polloRegion, polloEndpoints,
  polloCapabilities, validatePolloGeneration} from '../providers/pollo-capabilities.js';

/** Load once at host startup. Never read env, files or credentials inside the resolver. */
export function createVideoBindingRegistry(input: unknown): VideoBindingRegistry {
  try {
    const config = canonicalBindingJson(input);
    fields(config, ['schemaVersion', 'connections', 'bindings']);
    if (config.schemaVersion !== 1 || !Array.isArray(config.connections) || !Array.isArray(config.bindings) ||
      config.connections.length > 32 || config.bindings.length > 128) throw Error();
    const connections = new Map<string, {id: string; providerId: 'minimax' | 'pollo'; region: string; accountScopeId: string; credentialRef: string}>();
    for (const raw of config.connections) {
      fields(raw, ['id', 'providerId', 'region', 'accountScopeId', 'credentialRef']);
      const id = bindingLabel(raw.id), credentialRef = bindingLabel(raw.credentialRef);
      if ((raw.providerId !== 'minimax' && raw.providerId !== 'pollo') || !/^(env|keyring):[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(credentialRef) || connections.has(id)) throw Error();
      const region = raw.providerId === 'pollo' ? polloRegion(raw.region) : miniMaxRegion(raw.region);
      connections.set(id, {id, providerId: raw.providerId, region, accountScopeId: bindingLabel(raw.accountScopeId), credentialRef});
    }
    const specs = new Map<string, Omit<BindingSpec, 'ownerId'>>(), choices: VideoBindingChoice[] = [];
    for (const raw of config.bindings) {
      fields(raw, ['bindingKey', 'versionNo', 'connectionId', 'catalogId', 'operationKind', 'generation']);
      const bindingKey = bindingLabel(raw.bindingKey), versionNo = parseRevision(raw.versionNo),
        connection = connections.get(bindingLabel(raw.connectionId)), catalogId = bindingLabel(raw.catalogId), key = `${bindingKey}/${versionNo}`;
      if (!connection || specs.has(key)) throw Error();
      const deployment = getDeployment(connection.providerId, catalogId);
      const operationKind = raw.operationKind;
      if (deployment.mode !== 'job' || (operationKind !== 'text-to-video' && operationKind !== 'image-to-video')) throw Error();
      const pollo = connection.providerId === 'pollo';
      const generation = pollo ? validatePolloGeneration(deployment.endpoint, operationKind, raw.generation) : validateMiniMaxGeneration(deployment.endpoint, operationKind, raw.generation);
      specs.set(key, {
        bindingKey, versionNo, providerId: connection.providerId, modelId: deployment.endpoint,
        mode: 'job', adapterVersion: pollo ? POLLO_ADAPTER_VERSION : MINIMAX_ADAPTER_VERSION, capabilityVersion: pollo ? POLLO_CAPABILITY_VERSION : MINIMAX_CAPABILITY_VERSION,
        credentialRef: connection.credentialRef, schemaVersion: 1,
        parameters: {schemaVersion: 1, connectionId: connection.id, region: connection.region,
          endpointProfileId: pollo ? polloEndpoints[polloRegion(connection.region)].profileId : minimaxEndpoints[miniMaxRegion(connection.region)].profileId, providerAccountScopeId: connection.accountScopeId,
          catalogId, operationKind, protocolVersion: pollo ? 'platform' : 'v2', generation},
        capabilities: pollo ? polloCapabilities() : miniMaxCapabilities(deployment.endpoint, miniMaxRegion(connection.region)),
      });
      choices.push({bindingKey, versionNo, providerId: connection.providerId, modelId: deployment.endpoint, catalogId,
        connectionId: connection.id, region: connection.region, mode: 'job', operationKind, generation,
        canPrepare: true, canDispatch: false, accountVerification: 'unknown'});
    }
    return {
      resolve(owner, selection) {
        parseOwner(owner);
        fields(selection, ['bindingKey', 'versionNo']);
        const spec = specs.get(`${bindingLabel(selection.bindingKey)}/${parseRevision(selection.versionNo)}`);
        if (!spec) throw Error('PROVIDER_BINDING_NOT_REGISTERED');
        return parseBindingSpec({...spec, ownerId: owner.ownerId});
      },
      list: () => structuredClone(choices),
    };
  } catch { throw Error('INVALID_VIDEO_REGISTRY'); }
}
