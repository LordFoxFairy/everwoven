import {parseExecutionBinding, canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {fields} from '../contracts/story-draft-validation.js';
import {generationBindingHash} from '../application/generation.js';
import type {StructuredTextInput, StructuredTextModel, TextObservation} from '../ports/structured-text.js';

export const OPENROUTER_TEXT_VERSION = 'openrouter-structured-v1';
type Dependencies = {apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number;
  /** Installed model-specific counter/verified upper bound, including message/schema/image overhead. No guessed default. */
  countInputTokens(input: StructuredTextInput): number};
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const tokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
async function readJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();if (!reader) throw Error();
  let size = 0, complete = false;const chunks: Uint8Array[] = [];
  const cancel = () => {void reader.cancel().catch(() => {});};signal.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      signal.throwIfAborted();const next = await reader.read();signal.throwIfAborted();
      if (next.done) {complete = true;break;}size += next.value.byteLength;if (size > 262144) throw Error();chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } finally {signal.removeEventListener('abort', cancel);if (!complete) await reader.cancel().catch(() => {});reader.releaseLock();}
}
/** Official OpenRouter endpoint only; credentials are never forwarded to a user-supplied base URL. */
export function createOpenRouterText(raw: unknown, {apiKey, fetchImpl = fetch, timeoutMs = 60000, countInputTokens}: Dependencies): StructuredTextModel {
  const binding = parseExecutionBinding(raw);
  if (binding.mode !== 'text' || binding.providerId !== 'openrouter' || binding.adapterVersion !== OPENROUTER_TEXT_VERSION ||
    binding.capabilityVersion !== OPENROUTER_TEXT_VERSION || binding.parameters.protocolVersion !== 'openrouter-chat-v1' ||
    binding.parameters.endpointProfileId !== 'openrouter-global-v1' || binding.parameters.region !== 'global' ||
    !/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(binding.modelId) || binding.modelId === 'openrouter/auto') throw Error('OPENROUTER_BINDING_UNSUPPORTED');
  const caps = binding.capabilities;
  fields(caps, ['schemaVersion', 'structuredOutputs', 'imageInput', 'providerEndpoint']);
  if (caps.schemaVersion !== 1 || caps.structuredOutputs !== true || typeof caps.imageInput !== 'boolean' ||
    (binding.parameters.generation.inputModalities.some(modality => modality === 'image') && caps.imageInput !== true) ||
    typeof caps.providerEndpoint !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,119}$/.test(caps.providerEndpoint)) throw Error('OPENROUTER_BINDING_UNSUPPORTED');
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) || typeof countInputTokens !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('OPENROUTER_CONFIGURATION_UNAVAILABLE');
  const key = apiKey.trim(), bindingHash = generationBindingHash(binding), generation = binding.parameters.generation;
  return {bindingHash, async invoke(input, parentSignal) {
    let body: string;
    try {
      fields(input, ['system', 'text', 'schemaName', 'schema', 'images']);
      if (typeof input.system !== 'string' || !input.system || input.system.length > 16000 || typeof input.text !== 'string' || !input.text || input.text.length > 65536 ||
        typeof input.schemaName !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(input.schemaName) || !Array.isArray(input.images) || input.images.length > 16 ||
        (input.images.length && (!caps.imageInput || !generation.inputModalities.some(modality => modality === 'image')))) throw Error();
      const schema = canonicalBindingJson(input.schema);
      if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object' || JSON.stringify(schema).length > 32768) throw Error();
      for (const image of input.images) {
        fields(image, ['mimeType', 'bytes']);
        if (image.mimeType !== 'image/jpeg' || !(image.bytes instanceof Uint8Array) || !image.bytes.length || image.bytes.length > 262144) throw Error();
      }
      const inputTokens = countInputTokens(input);
      if (!tokenCount(inputTokens) || inputTokens > generation.maxInputTokens) throw Error();
      body = JSON.stringify({model: binding.modelId, stream: false, temperature: generation.temperature, max_tokens: generation.maxOutputTokens,
        provider: {only: [caps.providerEndpoint], order: [caps.providerEndpoint], allow_fallbacks: false, require_parameters: true},
        messages: [{role: 'system', content: input.system}, {role: 'user', content: [{type: 'text', text: input.text},
          ...input.images.map(image => ({type: 'image_url', image_url: {url: `data:image/jpeg;base64,${Buffer.from(image.bytes).toString('base64')}`}}))]}],
        response_format: {type: 'json_schema', json_schema: {name: input.schemaName, strict: true, schema}}});
      if (Buffer.byteLength(body) > 6 * 1024 * 1024) throw Error();
    } catch {throw Error('OPENROUTER_INPUT_OUTSIDE_BINDING');}
    if (parentSignal?.aborted) throw Error('OPENROUTER_NOT_SUBMITTED');
    const signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {method: 'POST', redirect: 'error', signal,
        headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, body});
      if (response.status !== 200) {await response.body?.cancel().catch(() => {});throw Error();}
      const result = record(await readJSON(response, signal)), choices = result.choices;
      if (result.object !== 'chat.completion' || result.model !== binding.modelId || typeof result.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(result.id) || !Array.isArray(choices) || choices.length !== 1) throw Error();
      const choice = record(choices[0]), message = record(choice.message);
      if (choice.finish_reason !== 'stop' || choice.index !== 0 || message.role !== 'assistant' || typeof message.content !== 'string' ||
        !message.content || message.refusal || message.tool_calls || message.function_call) throw Error();
      const usage: TextObservation['usage'] = {}, supplied = record(result.usage);
      for (const [wire, key] of [['prompt_tokens', 'inputTokens'], ['completion_tokens', 'outputTokens'], ['total_tokens', 'totalTokens']] as const) {
        if (!Object.hasOwn(supplied, wire)) continue;
        if (!tokenCount(supplied[wire])) throw Error();usage[key] = supplied[wire];
      }
      if ((usage.inputTokens !== undefined && usage.inputTokens > generation.maxInputTokens) ||
        (usage.outputTokens !== undefined && usage.outputTokens > generation.maxOutputTokens)) throw Error();
      return {value: JSON.parse(message.content), observation: {providerId: binding.providerId, modelId: binding.modelId, bindingHash,
        responseId: result.id, usage}};
    } catch {throw Error('OPENROUTER_RESULT_UNKNOWN');}
  }};
}
