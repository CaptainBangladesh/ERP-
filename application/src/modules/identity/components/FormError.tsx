import type { ReactNode } from 'react';

/**
 * A failure that belongs to the whole form rather than to one input.
 *
 * `role="alert"` so it is announced when it appears — a message a screen reader never
 * mentions is a message that did not reach the person it was for.
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}
