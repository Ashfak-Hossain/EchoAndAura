import { requestIp } from '@/lib/request-ip';
import {
  readTurnstileConfig,
  TURNSTILE_RESPONSE_FIELD,
  type TurnstileAction,
} from '@/lib/turnstile-config';
import { logger } from '@/server/lib/logger';
import { createTurnstileVerifier, type TurnstileVerifier } from '@/server/lib/turnstile';

/** What every protected form shows when the check fails. The buyer's input is kept. */
export const HUMAN_CHECK_FAILED =
  "We couldn't confirm you're not a bot. Please try again — if it keeps happening, refresh the page.";

let verifier: TurnstileVerifier | null = null;

function getVerifier(): TurnstileVerifier {
  verifier ??= createTurnstileVerifier(readTurnstileConfig());
  return verifier;
}

/**
 * ADR-048: the one line each protected server action adds after its Zod
 * parse — `if (!(await passesHumanCheck(formData, 'register'))) …`.
 * True when the form's Turnstile token is genuine (or Cloudflare could
 * not be asked; see the verifier).
 */
export async function passesHumanCheck(
  formData: FormData,
  action: TurnstileAction,
): Promise<boolean> {
  const verdict = await getVerifier().verify(formData.get(TURNSTILE_RESPONSE_FIELD), {
    action,
    ip: await requestIp(),
  });
  if (!verdict.ok) logger.info({ action, reason: verdict.reason }, 'turnstile check refused');
  return verdict.ok;
}
