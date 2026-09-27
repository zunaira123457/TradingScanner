import type { ApiError } from '@/lib/types';

export class FetchError extends Error {
  constructor(public status: number, public body: ApiError | null) {
    super(body?.message ?? body?.error ?? `Request failed (${status})`);
  }
  get notConfigured() {
    return this.status === 503 && this.body?.error === 'not_configured';
  }
  get rateLimited() {
    return this.status === 429;
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* not JSON */
    }
    throw new FetchError(res.status, body);
  }
  return res.json() as Promise<T>;
}
