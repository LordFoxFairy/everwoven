import { createAppClient } from '../../trpc/client';
import type { DatabaseDraftsClient } from './ports';
export function createDatabaseDraftsClient(): DatabaseDraftsClient {
  const client = createAppClient();
  async function sessionRequest(method: 'GET' | 'POST' | 'DELETE', code?: string): Promise<{ authenticated: boolean }> {
    try {
      const response = await fetch('/api/local-session', {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-everwoven-request': '1' },
        ...(code === undefined ? {} : { body: JSON.stringify({ code }) }),
      });
      if (!response.ok) throw Error();
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          !('authenticated' in data) || typeof data.authenticated !== 'boolean' ||
          (method !== 'GET' && data.authenticated !== (method === 'POST'))) throw Error();
      return { authenticated: data.authenticated };
    } catch {
      // Session failures may contain response bodies, parser snippets or private URLs.
      // Keep their message fixed; CRUD errors below must retain their domain metadata.
      throw Error('本机连接失败，请重试');
    }
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
