import { logger } from '@/server/lib/logger';
import { ticketQrSvg } from '@/server/lib/qr';
import { qrSvgToPath, renderTicketPdf } from '@/server/pdf/ticket-pdf';
import type { OrdersRepository } from '@/server/repositories/orders.repository';
import type { TicketTypesRepository } from '@/server/repositories/ticket-types.repository';
import type { OrdersService } from '@/server/services/orders.service';
import type { Mailer, OutgoingEmail } from './mailer';
import { type EmailKind, renderEmail } from './templates/render';
import type { EmailSender, EmailView } from './templates/view';
import type { SiteSettings } from '@/server/services/settings.service';

/**
 * Runs in the worker: turns "send the <kind> email for order X" into a
 * rendered, attached, sent message and an audit row. Everything here is
 * outside any database transaction (Invariant 7).
 */
export interface DispatchEnv {
  siteUrl: string;
  /**
   * Read per job, not at boot: the organizer edits these on B14 and the
   * next email must carry the new number without a worker restart.
   */
  settings: () => Promise<SiteSettings>;
}

/** The footer facts every email carries, from the settings row. */
export function emailSender(siteUrl: string, s: SiteSettings): EmailSender {
  return {
    siteUrl,
    contactEmail: s.supportEmail,
    contactPhone: s.supportPhone,
    organizerName: s.organizerName,
    organizerAddress: s.organizerAddress,
  };
}

export interface EmailDispatcherDeps {
  orders: OrdersService;
  ordersRepo: OrdersRepository;
  ticketTypes: TicketTypesRepository;
  mailer: Mailer;
  env: DispatchEnv;
  now?: () => Date;
  /** Injectable for tests; defaults to the real C5 renderer. */
  renderPdf?: (view: EmailView) => Promise<Buffer>;
}

/** Which statuses each email makes sense for; anything else is skipped, not sent. */
const SENDABLE: Record<EmailKind, readonly string[]> = {
  // A buyer who already submitted still gets the instructions they were
  // promised; an expired or finished order makes them misleading (and the
  // hold deadline is checked separately below).
  'payment-instructions': ['pending_payment', 'pending_verification'],
  'tickets-issued': ['issued'],
  rejected: ['rejected'],
  expired: ['expired'],
};

export class EmailSkippedError extends Error {
  constructor(
    public readonly kind: EmailKind,
    public readonly status: string,
  ) {
    super(`email ${kind} skipped: order is ${status}`);
    this.name = 'EmailSkippedError';
  }
}

async function defaultRenderPdf(v: EmailView): Promise<Buffer> {
  const tickets = await Promise.all(
    v.tickets.map(async (t) => {
      const qr = qrSvgToPath(await ticketQrSvg(t.code));
      return {
        code: t.code,
        position: t.position,
        attendeeName: t.attendeeName,
        status: t.status,
        qrPath: qr.path,
        qrViewBox: qr.viewBox,
      };
    }),
  );
  return renderTicketPdf({
    eventTitle: v.event.title,
    startsAt: v.event.startsAt,
    endsAt: v.event.endsAt,
    venue: v.event.venue,
    ticketTypeName: v.ticketType.name,
    orderReference: v.order.reference,
    registrationClosesAt: v.event.registrationClosesAt,
    issuedAt: v.tickets[0]?.createdAt ?? v.at,
    contactEmail: v.contactEmail,
    siteHost: new URL(v.siteUrl).host,
    tickets,
  });
}

export function createEmailDispatcher({
  orders,
  ordersRepo,
  ticketTypes,
  mailer,
  env,
  now = () => new Date(),
  renderPdf = defaultRenderPdf,
}: EmailDispatcherDeps) {
  return {
    /**
     * @throws EmailSkippedError when the order's status no longer fits the
     *   kind (recorded, not retried); MailerThrottledError to be retried.
     */
    async dispatch(kind: EmailKind, orderId: string): Promise<{ messageId: string }> {
      const view = await orders.getOrder(orderId);
      const { order, event, ticketType, tickets, events, promoCode } = view;
      if (!SENDABLE[kind].includes(order.status)) {
        await ordersRepo.insertEvent({
          orderId,
          actor: 'system',
          action: 'email.skipped',
          fromStatus: null,
          toStatus: null,
          note: `${kind}: order is ${order.status}`,
        });
        throw new EmailSkippedError(kind, order.status);
      }
      // C1 after the deadline would ask for money on a hold about to lapse.
      if (
        kind === 'payment-instructions' &&
        order.holdExpiresAt &&
        order.holdExpiresAt.getTime() <= now().getTime()
      ) {
        await ordersRepo.insertEvent({
          orderId,
          actor: 'system',
          action: 'email.skipped',
          fromStatus: null,
          toStatus: null,
          note: `${kind}: hold lapsed at ${order.holdExpiresAt.toISOString()}`,
        });
        throw new EmailSkippedError(kind, `${order.status} (hold lapsed)`);
      }

      // "When it happened" for the copy: the audit row that produced this status.
      const marker = [...events]
        .reverse()
        .find((e) =>
          kind === 'tickets-issued'
            ? e.action === 'payment.approved' || e.action === 'order.comp_issued'
            : kind === 'rejected'
              ? e.action === 'payment.rejected'
              : kind === 'expired'
                ? e.action === 'order.expired'
                : e.action === 'order.created',
        );
      const fresh = await ticketTypes.findById(order.ticketTypeId);
      const availableNow = fresh
        ? Math.max(0, fresh.quantityTotal - fresh.quantitySold - fresh.quantityReserved)
        : 0;

      const settings = await env.settings();
      const v: EmailView = {
        order,
        event,
        ticketType,
        tickets,
        promoCode,
        ...emailSender(env.siteUrl, settings),
        bkashNumber: settings.bkashReceiveNumber,
        bkashAccountName: settings.bkashAccountName,
        bkashAccountType: settings.bkashAccountType,
        verificationPromise: settings.verificationPromise,
        availableNow,
        at: marker?.createdAt ?? now(),
      };

      const rendered = await renderEmail(kind, v);
      const message: OutgoingEmail = {
        to: order.buyerEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: settings.supportEmail ?? undefined,
      };
      if (kind === 'tickets-issued') {
        message.attachments = [
          {
            filename: `tickets-${order.reference}.pdf`,
            content: await renderPdf(v),
            contentType: 'application/pdf',
          },
        ];
      }

      const { messageId } = await mailer.send(message);
      // The message is out. A throw from here would make BullMQ retry, and
      // a retry re-sends — so the audit write must never fail the job.
      try {
        await ordersRepo.insertEvent({
          orderId,
          actor: 'system',
          action: 'email.sent',
          fromStatus: null,
          toStatus: null,
          note: `${kind} → ${order.buyerEmail} · ${messageId}`,
        });
      } catch (err: unknown) {
        logger.error(
          { orderId, kind, messageId, err },
          'email sent but email.sent could not be recorded',
        );
      }
      logger.info({ orderId, kind, messageId }, 'email sent');
      return { messageId };
    },
  };
}

export type EmailDispatcher = ReturnType<typeof createEmailDispatcher>;
