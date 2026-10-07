import { beforeEach, describe, expect, it, vi } from 'vitest';
const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/server/container', () => ({ deploymentService: { check } }));
import { GET } from '@/app/api/deployment/route';

describe('deployment route', () => {
  beforeEach(() => check.mockReset());
  it.each([true, false])(
    'returns uncached readiness %s without operational details',
    async (ready) => {
      const report = { revision: 'a'.repeat(40), ready };
      check.mockResolvedValue(report);
      const response = await GET();
      expect(response.status).toBe(ready ? 200 : 503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual(report);
    },
  );
});
