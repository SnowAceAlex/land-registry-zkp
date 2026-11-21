'use client';

/** One required input file: what it is, which file is chosen (if any), and a pick/replace button. */

import { CircleAlert, CircleCheck, type LucideIcon } from 'lucide-react';

import { buttonStyles } from '@/components/ui/button';

export function FileSlot({
  icon: Icon,
  label,
  fileName,
  emptyText,
  chooseText,
  changeText,
  disabled,
  invalid,
  onFile,
}: {
  icon: LucideIcon;
  label: string;
  fileName: string | null;
  emptyText: string;
  chooseText: string;
  changeText: string;
  disabled?: boolean;
  /** The chosen file was rejected; the reason is shown by the caller. */
  invalid?: boolean;
  onFile: (file: File) => void;
}) {
  const chosen = fileName !== null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
        chosen && invalid
          ? 'border-red-200 bg-red-50/60'
          : chosen
            ? 'border-emerald-200 bg-emerald-50/60'
            : 'border-dashed border-hairline bg-surface'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {chosen && invalid ? (
          <CircleAlert className="h-5 w-5 shrink-0 text-red-600" strokeWidth={1.75} aria-hidden />
        ) : chosen ? (
          <CircleCheck
            className="h-5 w-5 shrink-0 text-emerald-600"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : (
          <Icon className="h-5 w-5 shrink-0 text-steel" strokeWidth={1.75} aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p
            aria-live="polite"
            className={`truncate text-xs ${chosen ? 'font-mono text-ink' : 'text-steel'}`}
          >
            {fileName ?? emptyText}
          </p>
        </div>
      </div>

      <label
        className={`${buttonStyles.secondary} cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-authority ${
          disabled ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        {chosen ? changeText : chooseText}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so re-picking the same file fires change again.
            event.target.value = '';
            if (file) onFile(file);
          }}
        />
      </label>
    </div>
  );
}
