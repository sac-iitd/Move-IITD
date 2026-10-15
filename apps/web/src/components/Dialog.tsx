import { useEffect, useId, useRef, type ReactNode } from 'react';

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
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
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
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink-950/60 p-3 sm:p-4">
      <div
        className="absolute inset-0"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      {/*
        min-h-0 lets this column shrink inside the viewport. Without it the
        panel grows past the screen, the page behind is locked, and the
        Confirm button cannot be reached.
      */}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[calc(100vh-1.5rem)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        style={{ maxHeight: 'calc(100dvh - 1.5rem)' }}
      >
        <h2 id={titleId} className="shrink-0 px-6 pt-6 text-lg font-bold text-ink-900">
          {title}
        </h2>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-2 text-sm text-ink-800">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-ink-900/10 px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
