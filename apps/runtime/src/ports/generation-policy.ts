import type {ExecutionProfileSpec} from '../contracts/execution-profile.js';
import type {BindingRecord} from '../contracts/provider-binding.js';
import type {StoryVersionDTO} from '../contracts/story-version.js';
/** Trusted synchronous host configuration, never request fields; missing evidence throws before writes. */
export type StagePrice={version:string;bindingHash:string;validUntil:string;currency:'CNY'|'USD';
  inputTokenMicros:string;outputTokenMicros:string;perTokens:string;outputSecondMicros:string;inputImageMicros:string;
  /** Explicit complete-meter tariff scope, verified by the installed adapter's policy. */
  complete:true;adapterReady:true};
export type GenerationPolicy={
 /** Recheck the installed runtime for a new paid acceptance. Historical receipt replay skips this. */
 assertDispatch(profile: import('./execution-profile-store.js').PinnedProfile): void;
 resolve(input:{binding:BindingRecord;story:StoryVersionDTO}):{
  profile:ExecutionProfileSpec;prices:{planner:StagePrice;video:StagePrice;validator:StagePrice};
  audio:'native'|'silent';artifactsReady:true;
  /** Maximum sampled output frames sent to the validator, included in the quote. */
  validatorImageLimit:number;
 };
};
