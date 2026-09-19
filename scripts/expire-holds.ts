/**
 * One-shot: expire lapsed holds now, print the count, exit. For ops (a
 * stuck worker) and for checking the job by hand: `pnpm jobs:expire-holds`.
 */
import { queryClient } from '@/db/client';
import { ordersService } from '@/server/container';

async function main(): Promise<void> {
  const { expired, failed } = await ordersService.expireLapsedHolds();
  console.log(
    `expired ${expired} lapsed hold${expired === 1 ? '' : 's'}${failed ? `, ${failed} skipped (see log)` : ''}`,
  );
  await queryClient.end();
  if (failed > 0) process.exit(2);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
