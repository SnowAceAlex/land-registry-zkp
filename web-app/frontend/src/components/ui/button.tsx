/**
 * Two button shapes, so radius and contrast stay consistent across the portals
 * rather than being re-decided per page. Both clear WCAG AA on their surfaces:
 * white on #0F172A is 16.8:1, ink on white is 16.1:1.
 */

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ui-transition tap-active disabled:pointer-events-none disabled:opacity-40';

export const buttonStyles = {
  primary: `${BASE} bg-authority text-white hover:bg-zinc-800`,
  secondary: `${BASE} border border-hairline bg-white text-ink hover:border-zinc-300`,
} as const;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return <button {...props} className={`${buttonStyles[variant]} ${className}`} />;
}
