import { createAppClient } from '../../trpc/client';
import type { DatabaseDraftsClient } from './ports';
import {createAuthoringSessionClient} from './session-client';
export function createDatabaseDraftsClient(): DatabaseDraftsClient {
  const client = createAppClient();
  return {
    ...createAuthoringSessionClient(),
    create: (input) => client.storyDrafts.create.mutate(input),
    get: (id) => client.storyDrafts.get.query({ id, includeDeleted: true }),
    list: (input) => client.storyDrafts.list.query(input),
    update: (input) => client.storyDrafts.update.mutate(input),
    delete: (input) => client.storyDrafts.delete.mutate(input),
    restore: (input) => client.storyDrafts.restore.mutate(input),
  };
}
