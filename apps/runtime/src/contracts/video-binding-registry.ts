import type {BindingResolver, BindingSpec, BindingJson} from './provider-binding.js';
import type {StoryProtocol} from './story-draft.js';
export type BindingDirectory = StoryProtocol & {
  status: 'ready' | 'empty' | 'unavailable' | 'not_initialized'; items: VideoBindingChoice[];
};
export type VideoBindingChoice = {
  bindingKey: string; versionNo: number; providerId: string; modelId: string; catalogId: string;
  connectionId: string; region: string; mode: 'job'; operationKind: 'text-to-video' | 'image-to-video';
  generation: {[key: string]: BindingJson}; canPrepare: true; canDispatch: false; accountVerification: 'unknown';
};
export interface VideoBindingRegistry extends BindingResolver {
  resolve(...args: Parameters<BindingResolver['resolve']>): BindingSpec;
  list(): VideoBindingChoice[];
}
