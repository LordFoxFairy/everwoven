import {fields, parseId, parseRevision} from './story-draft-validation.js';
import type {BindingJson, BindingSpec} from './provider-binding.js';

const code = 'INVALID_PROVIDER_BINDING';
export function bindingLabel(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) throw Error(code);
  return v;
}
/** Bounded, detached canonical JSON: no prototypes, accessors, undefined, sparse arrays or nonfinite values. */
export function canonicalBindingJson(input: unknown): BindingJson {
  let nodes = 0;
  function visit(v: unknown, depth: number): BindingJson {
    if (++nodes > 4096 || depth > 12) throw Error(code);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { if (v.length > 8192) throw Error(code); return v; }
    if (typeof v === 'number' && Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
    if (Array.isArray(v)) {
      if (v.length > 256 || Object.keys(v).length !== v.length || Reflect.ownKeys(v).length !== v.length + 1) throw Error(code);
      const out: BindingJson[] = [];
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, i);
        if (!d || !('value' in d)) throw Error(code);
        out.push(visit(d.value, depth + 1));
      }
      return out;
    }
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw Error(code);
    const keys = Object.keys(v).sort();
    if (keys.length > 256 || Reflect.ownKeys(v).length !== keys.length) throw Error(code);
    const out: {[key: string]: BindingJson} = {};
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in d)) throw Error(code);
      out[key] = visit(d.value, depth + 1);
    }
    return out;
  }
  const result = visit(input, 0);
  if (JSON.stringify(result).length > 65536) throw Error(code);
  return result;
}
function objectJson(v: unknown): {[key: string]: BindingJson} {
  const value = canonicalBindingJson(v);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(code);
  return value;
}
export function parseBindingSpec(input: unknown): BindingSpec {
  try {
    input = canonicalBindingJson(input);
    fields(input, ['ownerId', 'bindingKey', 'versionNo', 'providerId', 'modelId', 'adapterVersion', 'capabilityVersion', 'mode', 'credentialRef', 'parameters', 'capabilities', 'schemaVersion']);
    if (input.schemaVersion !== 1 || !['job', 'realtime'].includes(input.mode as string)) throw Error(code);
    const p = input.parameters;
    fields(p, ['schemaVersion', 'connectionId', 'region', 'endpointProfileId', 'providerAccountScopeId', 'catalogId', 'operationKind', 'protocolVersion', 'generation']);
    const caps = objectJson(input.capabilities);
    if (p.schemaVersion !== 1 || caps.schemaVersion !== 1) throw Error(code);
    return {
      ownerId: parseId(input.ownerId), bindingKey: bindingLabel(input.bindingKey), versionNo: parseRevision(input.versionNo),
      providerId: bindingLabel(input.providerId), modelId: bindingLabel(input.modelId),
      adapterVersion: bindingLabel(input.adapterVersion), capabilityVersion: bindingLabel(input.capabilityVersion),
      mode: input.mode as BindingSpec['mode'], credentialRef: bindingLabel(input.credentialRef),
      parameters: {
        schemaVersion: 1, connectionId: bindingLabel(p.connectionId), region: bindingLabel(p.region),
        endpointProfileId: bindingLabel(p.endpointProfileId), providerAccountScopeId: bindingLabel(p.providerAccountScopeId),
        catalogId: bindingLabel(p.catalogId), operationKind: bindingLabel(p.operationKind), protocolVersion: bindingLabel(p.protocolVersion),
        generation: objectJson(p.generation),
      },
      capabilities: caps as BindingSpec['capabilities'], schemaVersion: 1,
    };
  } catch { throw Error(code); }
}
