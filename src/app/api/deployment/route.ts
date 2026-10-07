import { deploymentService } from '@/server/container';

export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await deploymentService.check();
  return Response.json(report, {
    status: report.ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
