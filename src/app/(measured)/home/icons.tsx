/** Inline icons for the public pages (no icon font, no emoji). */
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function PinIcon({ className }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/** N7: beside "Exact venue is sent with your tickets" on a private venue (ADR-029). */
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg {...base} width={14} height={14} strokeWidth={2.2} className={className}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** The Facebook "f", filled: "Follow on Facebook" in the dormant hero and the follow block. */
export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.3v2.2H7.4V14h2.8v8h3.3z" />
    </svg>
  );
}
