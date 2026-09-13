import {v7} from 'uuid';
export function binding(ownerId = v7()) {
  return {
    ownerId, bindingKey: 'video-primary', versionNo: 1,
    providerId: 'minimax', modelId: 'MiniMax-H3-Max', adapterVersion: 'minimax-v2.1',
    capabilityVersion: 'minimax-h3-max.1', mode: 'job', credentialRef: 'local:minimax-cn',
    parameters: {
      schemaVersion: 1, connectionId: 'minimax-local-cn', region: 'cn',
      endpointProfileId: 'minimax-cn-v2', providerAccountScopeId: 'local-account-1',
      catalogId: 'minimax-h3-max', operationKind: 'text-to-video', protocolVersion: 'v2',
      generation: {duration: 5, resolution: '768P', aspectRatio: '16:9'},
    },
    capabilities: {schemaVersion: 1, evidence: 'unknown'}, schemaVersion: 1,
  };
}
