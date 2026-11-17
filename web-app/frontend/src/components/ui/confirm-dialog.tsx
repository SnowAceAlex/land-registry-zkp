'use client';

import { useEffect, useId, useRef } from 'react';

import { Button } from './button';

/**
 * A confirmation on the native modal <dialog>: the browser gives the focus trap, Esc and the backdrop.
 * `open` is the only source of truth, so Esc asks the parent to cancel instead of closing itself.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-hairline bg-surface p-6 text-ink shadow-[0_4px_24px_-4px_rgba(0,0,0,0.08)] backdrop:bg-zinc-950/40"
    >
      <h2 id={titleId} className="font-medium">
        {title}
      </h2>
      {children ? <div className="mt-2 text-sm leading-relaxed text-steel">{children}</div> : null}
      {/* Cancel comes first in the DOM, so it is what showModal() focuses. */}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
