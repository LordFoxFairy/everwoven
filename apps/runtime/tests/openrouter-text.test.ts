import {expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {createOpenRouterText, OPENROUTER_TEXT_VERSION} from '../src/providers/openrouter-text.js';
import type {TextBindingSpec} from '../src/contracts/provider-binding.js';
import type {StructuredTextInput} from '../src/ports/structured-text.js';

function binding(): TextBindingSpec {return {schemaVersion: 1, ownerId: v7(), bindingKey: 'planner', versionNo: 1, providerId: 'openrouter',
  modelId: 'fixture/model', mode: 'text', credentialRef: 'env:TEST_ONLY', adapterVersion: OPENROUTER_TEXT_VERSION, capabilityVersion: OPENROUTER_TEXT_VERSION,
  parameters: {schemaVersion: 1, connectionId: 'fixture', region: 'global', endpointProfileId: 'openrouter-global-v1', providerAccountScopeId: 'fixture',
    catalogId: 'fixture-model', operationKind: 'structured-generation', protocolVersion: 'openrouter-chat-v1',
    generation: {inputModalities: ['text', 'image'], maxInputTokens: 4096, maxOutputTokens: 1024, temperature: 0.5}},
  capabilities: {schemaVersion: 1, structuredOutputs: true, imageInput: true, providerEndpoint: 'fixture/endpoint'}};}
const input = (): StructuredTextInput => ({system: '系统说明', text: '故事输入', schemaName: 'scene',
  schema: {type: 'object', additionalProperties: false, required: ['prompt'], properties: {prompt: {type: 'string'}}}, images: []});
const payload = () => ({object: 'chat.completion', id: 'fixture-response', model: 'fixture/model', choices: [{index: 0, finish_reason: 'stop',
  message: {role: 'assistant', content: JSON.stringify({prompt: '人物走向窗边。'})}}], usage: {prompt_tokens: 50, completion_tokens: 20, total_tokens: 70}});
const adapter = (fetchImpl: typeof fetch, b = binding(), counter = () => 100) => createOpenRouterText(b, {apiKey: 'TEST_ONLY', fetchImpl, countInputTokens: counter});
it('makes exactly one official structured request with fixed model/endpoint, no fallback and bounded output', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json(payload())), model = adapter(send), request = input();
  request.images = [{mimeType: 'image/jpeg', bytes: Uint8Array.from([255, 216, 255, 217])}];
  expect(await model.invoke(request)).toMatchObject({value: {prompt: '人物走向窗边。'}, observation: {bindingHash: model.bindingHash,
    providerId: 'openrouter', modelId: 'fixture/model', responseId: 'fixture-response', usage: {inputTokens: 50, outputTokens: 20, totalTokens: 70}}});
  expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  const init = send.mock.calls[0]![1]!;expect(init.redirect).toBe('error');const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({model: 'fixture/model', stream: false, max_tokens: 1024, provider: {only: ['fixture/endpoint'],
    order: ['fixture/endpoint'], allow_fallbacks: false, require_parameters: true}, response_format: {type: 'json_schema', json_schema: {strict: true}}});
  expect(body).not.toHaveProperty('tools');expect(body).not.toHaveProperty('models');expect(body).not.toHaveProperty('plugins');
  expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
});
it.each(['wrong-model', 'truncated', 'tool', 'refusal', 'json', 'tokens', 'multiple'])('rejects %s response without regeneration', async kind => {
  const value = payload();
  if (kind === 'wrong-model') value.model = 'different/model';
  if (kind === 'truncated') value.choices[0]!.finish_reason = 'length';
  if (kind === 'tool') Object.assign(value.choices[0]!.message, {tool_calls: []});
  if (kind === 'refusal') Object.assign(value.choices[0]!.message, {refusal: 'no'});
  if (kind === 'json') value.choices[0]!.message.content = '{!';
  if (kind === 'tokens') value.usage.completion_tokens = 1025;
  if (kind === 'multiple') value.choices.push(value.choices[0]!);
  const send = vi.fn<typeof fetch>(async () => Response.json(value));await expect(adapter(send).invoke(input())).rejects.toThrow('OPENROUTER_RESULT_UNKNOWN');expect(send).toHaveBeenCalledOnce();
});
it('keeps missing usage unknown instead of inventing zero token counts', async () => {
  const {usage: _, ...value} = payload();const send = vi.fn<typeof fetch>(async () => Response.json(value));
  expect((await adapter(send).invoke(input())).observation.usage).toEqual({});
});
it.each([NaN, -1, 1.5, 4097])('blocks invalid/over-budget token estimate %s before a paid request', async count => {
  const send = vi.fn<typeof fetch>();await expect(adapter(send, binding(), () => count).invoke(input())).rejects.toThrow('OPENROUTER_INPUT_OUTSIDE_BINDING');expect(send).not.toHaveBeenCalled();
});
it('rejects a different protocol/supplier/region or automatic router at construction', () => {
  for (const patch of [{providerId: 'other'}, {modelId: 'openrouter/auto'}, {modelId: 'fixture/model:free'}, {adapterVersion: 'other'},
    {parameters: {...binding().parameters, region: 'cn'}}]) expect(() => adapter(vi.fn(), {...binding(), ...patch})).toThrow('OPENROUTER_BINDING_UNSUPPORTED');
});
it('rejects unsupported image inputs and oversized schemas before transport', async () => {
  const send = vi.fn<typeof fetch>(), b = binding();b.parameters.generation.inputModalities = ['text'];b.capabilities.imageInput = false;
  const request = input();request.images = [{mimeType: 'image/jpeg', bytes: new Uint8Array(4)}];
  await expect(adapter(send, b).invoke(request)).rejects.toThrow('OPENROUTER_INPUT_OUTSIDE_BINDING');
  await expect(adapter(send).invoke({...input(), schema: {type: 'object', description: 'a'.repeat(32769)}})).rejects.toThrow('OPENROUTER_INPUT_OUTSIDE_BINDING');expect(send).not.toHaveBeenCalled();
});
it('does not submit on pre-abort; errors and HTTP failures stay ambiguous and sanitized', async () => {
  const send = vi.fn<typeof fetch>(async () => {throw Error('secret/path/key');}), abort = new AbortController();abort.abort();
  await expect(adapter(send).invoke(input(), abort.signal)).rejects.toThrow('OPENROUTER_NOT_SUBMITTED');expect(send).not.toHaveBeenCalled();
  await expect(adapter(send).invoke(input())).rejects.toThrow(/^OPENROUTER_RESULT_UNKNOWN$/);expect(send).toHaveBeenCalledOnce();
  const limited = vi.fn<typeof fetch>(async () => new Response('private diagnostic', {status: 429}));
  await expect(adapter(limited).invoke(input())).rejects.toThrow(/^OPENROUTER_RESULT_UNKNOWN$/);expect(limited).toHaveBeenCalledOnce();
});
it('cancels an over-limit response body and never retries', async () => {
  const cancel = vi.fn(), send = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(262145));}, cancel})));
  await expect(adapter(send).invoke(input())).rejects.toThrow('OPENROUTER_RESULT_UNKNOWN');expect(cancel).toHaveBeenCalled();expect(send).toHaveBeenCalledOnce();
});
