import { useEffect, useRef } from 'react';

/** Inline two-step confirm: focus moves to the confirm button when it opens and back to its trigger on cancel. */
export function useConfirmFocus<K extends string | number>(open: K | null) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggers = useRef(new Map<K, HTMLButtonElement>());
  const last = useRef<K | null>(null);

  useEffect(() => {
    if (open !== null) {
      last.current = open;
      confirmRef.current?.focus();
    } else if (last.current !== null) {
      triggers.current.get(last.current)?.focus();
      last.current = null;
    }
  }, [open]);

  const triggerRef = (key: K) => (element: HTMLButtonElement | null) => {
    if (element) triggers.current.set(key, element);
    else triggers.current.delete(key);
  };

  return { confirmRef, triggerRef };
}
