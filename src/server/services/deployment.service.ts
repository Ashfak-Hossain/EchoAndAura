import { gitRevision } from '@/server/lib/image-revision';

interface DeploymentProbes {
  revision(): string | null;
  health(): Promise<{ ok: boolean }>;
  worker(revision: string): Promise<void>;
}
export interface DeploymentReport {
  revision: string | null;
  ready: boolean;
}

/** Only a public commit and a boolean. No hosts, timestamps, environment or errors. */
export function createDeploymentService(probes: DeploymentProbes, timeoutMs = 2_500) {
  return {
    async check(): Promise<DeploymentReport> {
      let revision: string | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const parsed = gitRevision.safeParse(probes.revision());
        if (!parsed.success) return { revision: null, ready: false };
        revision = parsed.data;
        const check = Promise.all([probes.health(), probes.worker(revision)])
          .then(([health]) => health.ok)
          .catch(() => false);
        const timeout = new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        });
        return { revision, ready: await Promise.race([check, timeout]) };
      } catch {
        return { revision, ready: false };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
