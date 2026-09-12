import { createAppClient } from '../../trpc/client';
import type { DatabaseDraftsClient } from '../../components/database-drafts';
export function createDatabaseDraftsClient(): DatabaseDraftsClient {
  const client = createAppClient();
  async function sessionRequest(method: string, code?: string) {
    const response = await fetch('/api/local-session', {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-everwoven-request': '1' },
      ...(code === undefined ? {} : { body: JSON.stringify({ code }) }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : '本机连接失败，请重试');
    return data as { authenticated: boolean };
  }
  return {
    session: () => sessionRequest('GET'),
    connect: async (code) => {
      await sessionRequest('POST', code);
    },
    logout: async () => {
      await sessionRequest('DELETE');
    },
    create: (input) => client.storyDrafts.create.mutate(input),
    get: (id) => client.storyDrafts.get.query({ id, includeDeleted: true }),
    list: (input) => client.storyDrafts.list.query(input),
    update: (input) => client.storyDrafts.update.mutate(input),
    delete: (input) => client.storyDrafts.delete.mutate(input),
    restore: (input) => client.storyDrafts.restore.mutate(input),
  };
}
