import type {TextBindingSpec} from '../contracts/provider-binding.js';
export type StructuredTextInput = {system: string; text: string; schemaName: string; schema: Record<string, unknown>;
  images: {mimeType: 'image/jpeg'; bytes: Uint8Array}[]};
export type TextObservation = {providerId: string; modelId: string; bindingHash: string; responseId: string;
  usage: {inputTokens?: number; outputTokens?: number; totalTokens?: number}};
export type StructuredTextResult = {value: unknown; observation: TextObservation};
export interface StructuredTextModel {
  readonly bindingHash: string;
  /** One paid attempt. Invalid output/uncertain network outcome must propagate, never regenerate. */
  invoke(input: StructuredTextInput, signal?: AbortSignal): Promise<StructuredTextResult>;
}
export type StructuredTextResolver = (binding: TextBindingSpec) => StructuredTextModel;
