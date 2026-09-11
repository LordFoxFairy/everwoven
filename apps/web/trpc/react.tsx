'use client';

import {useState} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createTRPCContext} from '@trpc/tanstack-react-query';
import type {AppRouter} from '../server/api/root';
import {createAppClient} from './client';

export const {TRPCProvider, useTRPC} = createTRPCContext<AppRouter>();

export function TRPCReactProvider({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {staleTime: 0, retry: false, refetchOnWindowFocus: false},
      mutations: {retry: false},
    },
  }));
  const [client] = useState(createAppClient);
  return <QueryClientProvider client={queryClient}>
    <TRPCProvider trpcClient={client} queryClient={queryClient}>{children}</TRPCProvider>
  </QueryClientProvider>;
}
