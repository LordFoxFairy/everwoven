import type {CreateExperience, GetPreparingExperience, ExperienceOpeningDTO, ExperienceOpeningResult} from 'runtime/contracts/experience-opening';
import type {BindingDirectory} from 'runtime/contracts/video-binding-registry';
import type {StoryProtocol} from 'runtime/contracts/story-draft';
import type {OpeningErrorCode} from '../../contracts/experience-http';
export interface OpeningClient {
  bindings(input: StoryProtocol): Promise<BindingDirectory>;
  create(input: CreateExperience): Promise<ExperienceOpeningResult>;
  getPreparing(input: GetPreparingExperience): Promise<ExperienceOpeningDTO>;
}
export class OpeningClientError extends Error {
  readonly name = 'OpeningClientError';
  constructor(readonly code: OpeningErrorCode | 'OPENING_NETWORK_ERROR' | 'OPENING_RESPONSE_INVALID', readonly status: number | null, readonly outcome: 'rejected' | 'unknown') {super(code);}
}
