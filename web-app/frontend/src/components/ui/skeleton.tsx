/**
 * Placeholder in the shape of the content it stands in for (DESIGN.md §4:
 * skeletons, not spinners). The pulse is collapsed by the global
 * prefers-reduced-motion rule in globals.css.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-zinc-100 ${className}`} />;
}
