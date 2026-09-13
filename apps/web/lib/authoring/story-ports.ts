import type {DraftCreate, DraftGet, DraftListInput, DraftUpdate, DraftLifecycle, DraftDTO, DraftPage, DraftCommandResult} from '../../../runtime/src/contracts/story-draft';
import type {StoryErrorCode} from '../../contracts/story-http';

export interface StoryDraftClient {
  create(input: DraftCreate): Promise<DraftCommandResult>;
  get(input: DraftGet): Promise<DraftDTO>;
  list(input: DraftListInput): Promise<DraftPage>;
  update(input: DraftUpdate): Promise<DraftCommandResult>;
  delete(input: DraftLifecycle): Promise<DraftCommandResult>;
  restore(input: DraftLifecycle): Promise<DraftCommandResult>;
}
export type StoryClientErrorCode = StoryErrorCode | 'STORY_NETWORK_ERROR' | 'STORY_RESPONSE_INVALID';
/** outcome describes only this attempt, never whether an earlier unknown write committed. */
export class StoryClientError extends Error {
  readonly name = 'StoryClientError';
  constructor(readonly code: StoryClientErrorCode, readonly status: number | null, readonly outcome: 'rejected' | 'unknown') {super(code);}
}
