/** Inline stroke icons for the public pages (no icon font, no emoji). */
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

export function MailIcon({ className }: { className?: string }) {
  return (
    <svg {...base} width={22} height={22} className={className}>
      <path d="M3 8l9 6 9-6" />
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}

export function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg {...base} width={22} height={22} className={className}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg {...base} width={22} height={22} className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
