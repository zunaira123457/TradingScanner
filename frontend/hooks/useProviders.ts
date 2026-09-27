'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { ProviderStatus } from '@/lib/types';

export function useProviders() {
  const { data } = useSWR<{ providers: ProviderStatus }>('/api/health', fetcher, { revalidateOnFocus: false });
  return data?.providers ?? null;
}
