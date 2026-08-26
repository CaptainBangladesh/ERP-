import type { ReactNode } from 'react';

/**
 * The one place a button decides what it looks like.
 *
 * Extracted for the same reason `Field` was: not because writing `className` on a `<button>`
 * is hard, but because doing it fourteen times produces fourteen slightly different buttons.
 * The CRM modals had accumulated amber primaries, teal primaries, and slate-800 primaries for
 * the same job, and no reviewer catches that by reading one file at a time.
 *
 * `variant` says what the button *is* in the sentence the screen is making — the one action the
 * screen is for, a way back out, something destructive — never what colour it should be. That is
 * what keeps a later change of palette a change to this file.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  /** The single action a screen exists to perform. At most one per view, or none is primary. */
  primary: 'bg-teal-700 text-white shadow-xs hover:bg-teal-800 focus-visible:ring-teal-600',
  /** An action that stands beside the primary one — cancel, or a secondary path. */
  secondary:
    'border border-slate-300 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 focus-visible:ring-slate-400',
  /** Carries no chrome until pointed at. For actions that would otherwise crowd the layout. */
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400',
  /**
   * Destructive and irreversible. Red is spent only here, which is what keeps it legible as a
   * warning rather than as decoration.
   */
  danger: 'bg-red-600 text-white shadow-xs hover:bg-red-700 focus-visible:ring-red-500',
};

const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-xs',
  lg: 'px-4 py-2 text-sm',
} as const;

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled,
  title,
  ariaLabel,
  fullWidth,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: keyof typeof SIZES;
  /**
   * Defaults to `button`, not `submit`. A bare `<button>` inside a form submits it, which is
   * how a "Cancel" beside a form ends up reloading the page — a bug that only shows up on the
   * one path nobody clicks while building the feature.
   */
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  /** Only for a button whose visible content is an icon and so has no readable name. */
  ariaLabel?: string;
  fullWidth?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANTS[variant]
      } ${SIZES[size]} ${fullWidth ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
}
