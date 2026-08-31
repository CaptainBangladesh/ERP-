import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';

/**
 * Seam 2 — the frontend network boundary.
 *
 * The HTTP layer is intercepted; everything above it is real. `onUnhandledRequest: 'error'`
 * is deliberate: a request no handler covers is a test asserting against a silent failure,
 * which is worse than no test at all.
 */
beforeAll(() => {
  vi.stubEnv('VITE_API_URL', '');
  server.listen({ onUnhandledRequest: 'error' });
});

/**
 * Links the application hands to the browser — `mailto:` on a lead's address, an external
 * site — are still links under test, and clicking one is a fair thing for a test to do.
 * jsdom cannot navigate, and it does not find that out synchronously: it queues the follow
 * on a timer and raises "Not implemented: navigation" whenever that timer fires, which is
 * typically after the test that clicked has finished and sometimes after the environment
 * holding it has been torn down. An error with no test left to attribute it to is an
 * unhandled error, and vitest fails the whole run on one — a suite whose every test passes
 * still exits non-zero, on a race that only loses on a loaded machine. Hence CI and not here.
 *
 * Cancelling the default keeps the click real — handlers still run, assertions still hold —
 * and stops only the navigation jsdom was never going to perform. In-app links are left
 * alone: the router reads `defaultPrevented` and would decline to route if this touched
 * them, so only the schemes that leave the application are cancelled.
 */
const LEAVES_THE_APP = /^(?:mailto:|tel:|sms:|https?:\/\/)/i;

beforeAll(() => {
  document.addEventListener(
    'click',
    (event) => {
      const href = (event.target as Element | null)?.closest?.('a[href]')?.getAttribute('href');
      if (href && LEAVES_THE_APP.test(href)) event.preventDefault();
    },
    true,
  );
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
