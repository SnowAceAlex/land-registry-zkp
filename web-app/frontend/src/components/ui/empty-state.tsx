import type { LucideIcon } from 'lucide-react';

/**
 * A composed empty state, per DESIGN.md section 4: it says what belongs here
 * and how to put it there. Centred grey text saying "No data" tells an officer
 * nothing about whether the system is broken or simply idle.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-hairline bg-white px-6 py-14 text-center">
      <span className="rounded-full border border-hairline bg-zinc-50 p-3.5">
        <Icon className="h-5 w-5 text-steel" strokeWidth={1.5} aria-hidden />
      </span>
      <h3 className="mt-5 font-medium text-ink">{title}</h3>
      <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-steel">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
