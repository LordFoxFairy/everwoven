import {createTRPCClient, httpBatchLink} from '@trpc/client';
import type {AppRouter} from '../server/api/root';

export function createAppClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({url: '/api/trpc', headers: {'x-everwoven-request':'1'}, fetch: (url, options) => fetch(url, {
      ...options, credentials: 'same-origin', cache: 'no-store',
    })})],
  });
}
