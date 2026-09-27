'use client';

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">{error.message || 'The dashboard hit an unexpected error.'}</p>
        <button type="button" onClick={() => retry()} className="mt-4 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
