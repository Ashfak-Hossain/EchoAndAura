export type AppEnvironment = 'local' | 'staging' | 'production';

/** `APP_ENV` if set, else derived from NODE_ENV. */
export function currentEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const explicit = env.APP_ENV;
  if (explicit === 'local' || explicit === 'staging' || explicit === 'production') return explicit;
  return env.NODE_ENV === 'production' ? 'production' : 'local';
}

// B2: mono, 28px, radius 4. Production is solid charcoal because destructive
// actions live there; staging marigold tint; local info tint.
const STYLES: Record<AppEnvironment, string> = {
  production: 'bg-foreground text-background',
  staging: 'border border-[#f0d9ac] bg-accent text-[#5c4514]',
  local: 'border border-[#c3d6ec] bg-info-tint text-[#194673]',
};

export function EnvChip() {
  const env = currentEnvironment();
  return (
    <span
      className={`inline-flex h-7 items-center rounded px-2.5 font-mono text-xs font-medium tracking-[0.08em] uppercase ${STYLES[env]}`}
    >
      {env}
    </span>
  );
}
