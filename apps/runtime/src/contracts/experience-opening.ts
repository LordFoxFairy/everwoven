import type {StoryProtocol} from './story-draft.js';
import type {StoryVersionDTO} from './story-version.js';
import type {PublicBinding} from './provider-binding.js';

export type ExperienceBudget = {limitMicros: string; currency: 'CNY' | 'USD'};
export type CreateExperience = StoryProtocol & {
  commandId: string; storyDraftId: string; expectedStoryRevision: number;
  bindingKey: string; expectedBindingVersion: number; budget: ExperienceBudget;
};
export type GetPreparingExperience = StoryProtocol & {id: string};
/** Historical CREATE acknowledgement, not a current playback snapshot or spending authorization. */
export type ExperienceOpeningDTO = StoryProtocol & {
  id: string; revision: 1; status: 'preparing'; schedulingPaused: true;
  createdAt: string; story: StoryVersionDTO; binding: PublicBinding; budget: ExperienceBudget;
  setup: {id: string; kind: 'setup'; experienceId: string; experienceRevision: 1; options: []};
  responseDraft: {id: string; experienceId: string; interactionEventId: string; text: ''; revision: 1};
  media: null; canRespond: false; canDispatch: false;
};
export type ExperienceOpeningResult = {data: ExperienceOpeningDTO; replayed: boolean};
