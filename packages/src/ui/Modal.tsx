import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * The dialog every screen's modal is built from.
 *
 * Fourteen modals in `crm` alone had each written their own backdrop, their own header row, and
 * their own close button, and the drift was exactly what you would predict: two of them came out
 * dark navy with amber buttons while the rest of the product is white and teal. A modal is not
 * where a screen should be expressing itself, so it stopped being a decision each screen makes.
 *
 * The behaviour is the other half of the reason. A dialog owes the person using it four things
 * that are individually easy and collectively always forgotten: Escape closes it, focus moves
 * inside it and cannot Tab out to the page behind, focus returns to whatever opened it, and the
 * page underneath does not scroll. Written once here, every modal has them by construction.
 */
export function Modal({
  onClose,
  title,
  description,
  icon,
  size = 'md',
  footer,
  children,
}: {
  onClose: () => void;
  title: string;
  /** A sentence under the title saying what this dialog is for. Optional; most need one. */
  description?: ReactNode;
  /** A single emoji beside the title. Decorative — the title already names the dialog. */
  icon?: string;
  size?: keyof typeof WIDTHS;
  /**
   * The action row. Rendered on a fixed bar below the scroll area rather than at the end of
   * the content, so the way out of a long dialog does not require scrolling to reach.
   */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    /**
     * Whatever had focus when the dialog opened. Captured before focus is moved, and restored
     * on the way out — otherwise closing a dialog drops the caret back at the top of the
     * document and a keyboard user has to Tab through the page to get back to where they were.
     */
    const opener = document.activeElement as HTMLElement | null;

    dialogRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      /**
       * The focus trap. Read on each Tab rather than cached, because a dialog's contents
       * change while it is open — a form appears, a row is deleted — and a list captured at
       * mount would send focus to a button that is no longer on the screen.
       */
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      // Closing on the backdrop is a convenience, so it is deliberately only the backdrop
      // itself — a click that started on the dialog and drifted outward while selecting text
      // would otherwise throw away everything the person had typed.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        // Focusable so the dialog itself can hold focus on open. `-1` keeps it out of the Tab
        // order, so it is a starting point rather than an extra stop on the way round.
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full flex-col rounded-xl border border-slate-200 bg-white shadow-xl outline-none ${WIDTHS[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id={headingId} className="flex items-center gap-2 text-base font-bold text-slate-900">
              {icon && <span aria-hidden="true">{icon}</span>}
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs text-slate-500">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

/**
 * What counts as a stop on the way round the dialog. `[tabindex="-1"]` is excluded on purpose:
 * that is the value used to make something focusable *programmatically* without adding it to
 * the Tab order, including the dialog's own container above.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Inline, like every other icon here — the dependency rule bars packages that ship markup. */
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
