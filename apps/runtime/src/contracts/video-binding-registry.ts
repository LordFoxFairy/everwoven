import type {BindingResolver, BindingSpec, BindingJson} from './provider-binding.js';
export type VideoBindingChoice = {
  bindingKey: string; versionNo: number; providerId: string; modelId: string; catalogId: string;
  connectionId: string; region: string; mode: 'job'; operationKind: 'text-to-video' | 'image-to-video';
  generation: {[key: string]: BindingJson}; canPrepare: true; canDispatch: false; accountVerification: 'unknown';
};
export interface VideoBindingRegistry extends BindingResolver {
  resolve(...args: Parameters<BindingResolver['resolve']>): BindingSpec;
  list(): VideoBindingChoice[];
}
