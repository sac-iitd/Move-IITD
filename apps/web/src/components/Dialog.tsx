import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible modal dialog: focus moves into the dialog, Tab is trapped,
 * Escape closes (unless busy), and focus returns to the trigger on close.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  busy = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const focusables = () =>
    Array.from(
      ref.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

  // Move focus in only when the dialog opens. Re-running this on every
  // keystroke (because onClose is a new function) was jumping focus to the
  // first control, the "Myself" radio, after each digit in the phone field.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    (focusables()[0] ?? node)?.focus();
    return () => {
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  // Rendered on document.body, outside the animated page, so the window can
  // scroll the whole dialog. Locking the page and capping the panel left the
  // Confirm button below the screen with nowhere to scroll.
  return createPortal(
    <div
      data-scroll-dialog="1"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        background: 'rgb(42 23 20 / 0.6)',
      }}
    >
      <div
        style={{
          display: 'flex',
          minHeight: '100%',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '1rem',
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        >
          <h2 id={titleId} className="text-lg font-bold text-ink-900">
            {title}
          </h2>
          <div className="mt-3 text-sm text-ink-800">{children}</div>
          {footer && (
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
