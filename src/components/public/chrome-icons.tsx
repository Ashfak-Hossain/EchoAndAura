/**
 * Stroke icons for the public chrome (Canvas 6, N1/N4). No directive, so the
 * server header and the client phone menu can both use them.
 */
const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
};

/** The signed-in account link: 18px in the header, 20px in the menu. */
export function PersonIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...stroke} width={size} height={size} className="shrink-0">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg {...stroke} width={22} height={22}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...stroke} width={22} height={22}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
