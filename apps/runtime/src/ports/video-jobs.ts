/** Normalized video operations. Vendor routes, model enums and wire formats belong to adapters. */
export type VideoFrames = {first?: string; last?: string};
export type VideoPlanInput = {prompt: string; frames?: VideoFrames};
export type PreparedVideoInput = VideoPlanInput & {duration: number; resolution: string; ratio: string};
export type VideoTaskReference = {
  providerId: string; operationId: string; taskId: string; bindingId: string; bindingHash: string;
  connectionId: string; accountScopeId: string; region: string; modelId: string;
  requestHash: string; firstSubmittedAt: string;
};
export type GeneratedVideo = {url: string; ratio: string; resolution: string; duration: number};
export type VideoUsage = Partial<Record<'output_seconds' | 'input_seconds' | 'total_seconds' | 'input_image_count' |
  'input_audio_seconds' | 'total_tokens' | 'prompt_tokens' | 'completion_tokens', number>>;
export type VideoJobSnapshot = {
  taskId: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  video?: GeneratedVideo; usage?: VideoUsage;
};
export interface VideoJobAdapter {
  readonly mode: 'job';
  readonly bindingId: string;
  readonly bindingHash: string;
  /** Pure. Apply the sealed model/specification and validate supported input before persistence. */
  prepare(input: VideoPlanInput): PreparedVideoInput;
  /** Pure. Revalidate saved input against this exact binding before any paid operation. */
  validatePrepared(input: unknown): PreparedVideoInput;
  /** Pure. Validate supplier/binding/account identity; never reinterpret an old reference for another supplier. */
  reference(input: unknown): VideoTaskReference;
  /** One attempt only; ambiguous acceptance must never be retried automatically. */
  submit(operationId: string, input: unknown, signal?: AbortSignal): Promise<VideoTaskReference>;
  read(reference: unknown, signal?: AbortSignal): Promise<VideoJobSnapshot>;
}
