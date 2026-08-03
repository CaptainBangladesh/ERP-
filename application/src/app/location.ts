import { useSyncExternalStore } from 'react';

/**
 * Where the user is, and how they get somewhere else.
 *
 * Hand-written rather than a router dependency. The frontend rule is that a dependency must
 * render no markup and no CSS, and a router passes that — but the whole of what this
 * application needs from one today is "which of a handful of exact paths are we on", and
 * about thirty lines answers it. When nested routes, parameters, or lazy segments arrive
 * and this file starts growing features a library already has, that is the moment to adopt
 * one rather than now.
 */
const NAVIGATED = 'erp:navigated';

export function useLocationPath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/**
 * The query string of wherever the browser is now.
 *
 * Not reactive, unlike `useLocationPath`: the one use today is reading a token off a link a
 * user arrived on — `?token=…` — which does not change while the screen it named is open, so
 * there is nothing here for a subscription to watch for.
 */
export function currentSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function subscribe(onChange: () => void): () => void {
  // `popstate` covers back and forward; the custom event covers `navigate` below, because
  // pushState deliberately does not fire one.
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATED, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATED, onChange);
  };
}

export function navigate(path: string, { replace = false } = {}): void {
  if (window.location.pathname === path) return;

  // Replace, not push, when the app is correcting where somebody is — being sent to
  // sign-in should not leave a back button that returns to a screen they cannot see.
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  window.dispatchEvent(new Event(NAVIGATED));
}

/**
 * An anchor that navigates without reloading the page.
 *
 * A real `href` so the link can be opened in a new tab, middle-clicked, and read by a
 * screen reader as the link it is; the click handler only takes over the ordinary case.
 */
export function linkProps(path: string): {
  href: string;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
} {
  return {
    href: path,
    onClick: (event) => {
      // Leave modified clicks alone: they mean "open this somewhere else", which is the
      // browser's job and not ours.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
