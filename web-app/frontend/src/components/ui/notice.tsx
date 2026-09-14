import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';

/**
 * An inline message with a tone. Server-safe (no state), so a screen can render
 * a warning without shipping JavaScript for it.
 *
 * `danger` announces itself (`role="alert"`) because it reports something that
 * just failed; the other tones are `role="status"` and wait their turn.
 */
type Tone = 'info' | 'warning' | 'danger' | 'success';

const TONES: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: 'border-hairline bg-white text-ink', icon: Info },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-950', icon: TriangleAlert },
  danger: { box: 'border-red-200 bg-red-50 text-red-900', icon: CircleAlert },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-950', icon: CircleCheck },
};

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start ${box}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-1 leading-relaxed break-words opacity-90">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
