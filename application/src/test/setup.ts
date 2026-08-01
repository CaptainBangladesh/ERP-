import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';

/**
 * Seam 2 — the frontend network boundary.
 *
 * The HTTP layer is intercepted; everything above it is real. `onUnhandledRequest: 'error'`
 * is deliberate: a request no handler covers is a test asserting against a silent failure,
 * which is worse than no test at all.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
