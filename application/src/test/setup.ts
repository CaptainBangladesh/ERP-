import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { server } from './server';

/**
 * The same slow-runner problem `testTimeout` is set against, one layer down.
 *
 * `waitFor` and every `findBy*` query carry their own default of one second, which the
 * vitest `testTimeout` does not touch. A single mutation round-trip — a file upload is the
 * event, a React re-render, the fetch, and MSW parsing the multipart body back out — stays
 * well under a second on a development machine and can cross it on a CI runner that is a
 * fraction of one and shares what it has. Raising the async-utility ceiling to match keeps a
 * green test as fast as it always was (the wait resolves the moment its condition holds) and
 * stops a scheduling accident on the slower machine from being reported as a broken feature.
 */
configure({ asyncUtilTimeout: 5_000 });

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
const LEAVES_THE_APP = /^(?:mailto:|tel:|sms:|blob:|https?:\/\/)/i;

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

/**
 * Object URLs, which jsdom does not implement at all.
 *
 * A file the application downloads or thumbnails is fetched with the session header and then
 * handed to the browser as an object URL — there is no other way to reach an authenticated
 * endpoint from an `<img>` or a save. jsdom leaves `createObjectURL` undefined, so without
 * this every such component throws on render rather than being testable. The counter makes
 * each URL distinguishable, which is what lets a test assert that the right file was fetched.
 */
beforeAll(() => {
  let issued = 0;
  URL.createObjectURL = () => `blob:test/${(issued += 1)}`;
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
