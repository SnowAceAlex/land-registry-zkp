/**
 * A root, commitment or transaction hash, shortened for a table cell.
 *
 * These values are 60–78 characters and meaningless to read in full, but an
 * officer does compare their ends against a block explorer — so the head and
 * tail stay visible, the full value is in the tooltip, and screen readers get
 * the whole string rather than an ellipsis.
 */
export function HashText({
  value,
  head = 8,
  tail = 6,
  className = '',
}: {
  value: string;
  head?: number;
  tail?: number;
  className?: string;
}) {
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return (
    <span className={`font-mono text-xs ${className}`} title={value}>
      <span aria-hidden>{short}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
