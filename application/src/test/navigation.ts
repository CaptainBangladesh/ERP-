/**
 * Watching the application leave.
 *
 * A few things the application does are not requests at all — signing in with Google is a
 * whole-page navigation to an address that answers with a redirect. jsdom has no navigation
 * to perform, so the only way to assert on one is to stand in for `window.location` and
 * record where it was sent.
 *
 * Restored after each test by the returned handle, because a `window.location` left standing
 * in would follow the suite into every file after it.
 */
export function captureNavigationAway(): {
  destination: () => string | undefined;
  restore: () => void;
} {
  const real = window.location;
  let sentTo: string | undefined;

  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      assign: (url: string) => {
        sentTo = url;
      },
      replace: (url: string) => {
        sentTo = url;
      },
    }),
  });

  return {
    destination: () => sentTo,
    restore: () => {
      Object.defineProperty(window, 'location', { configurable: true, value: real });
    },
  };
}
