import type {DraftCreate, DraftCommandResult, DraftDTO, DraftListInput, DraftPage, DraftUpdate, DraftLifecycle} from '../../../runtime/src/contracts/story-draft';

export type AuthoringSession = {authenticated: true; datasetId: string} | {authenticated: false};

export interface DatabaseDraftsClient {
  session(): Promise<AuthoringSession>;
  connect(code: string): Promise<void>;
  logout(): Promise<void>;
  create(input: DraftCreate): Promise<DraftCommandResult>;
  get(id: string): Promise<DraftDTO>;
  list(input?: DraftListInput): Promise<DraftPage>;
  update(input: DraftUpdate): Promise<DraftCommandResult>;
  delete(input: DraftLifecycle): Promise<DraftCommandResult>;
  restore(input: DraftLifecycle): Promise<DraftCommandResult>;
}
