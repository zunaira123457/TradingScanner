import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// jsdom-only browser APIs the app relies on.
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}
