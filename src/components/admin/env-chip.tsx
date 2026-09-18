import { Chip } from '@/components/status-chip';

export type AppEnvironment = 'local' | 'staging' | 'production';

/** `APP_ENV` if set, else derived from NODE_ENV. */
export function currentEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const explicit = env.APP_ENV;
  if (explicit === 'local' || explicit === 'staging' || explicit === 'production') return explicit;
  return env.NODE_ENV === 'production' ? 'production' : 'local';
}

// B2: loud only in production, because destructive actions live here.
export function EnvChip() {
  const env = currentEnvironment();
  return (
    <Chip
      tone={env === 'production' ? 'accent' : 'neutral'}
      className="tracking-[0.12em] uppercase"
    >
      {env}
    </Chip>
  );
}
