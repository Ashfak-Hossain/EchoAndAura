import Link from 'next/link';
import type { FaqItem } from '@/components/public/faq-accordion';

/**
 * Canvas 5 (A7.4): the questions grouped by what people are doing. Ids are
 * jump-link anchors (`/faq#paying-by-bkash`) — the topics are navigation,
 * not filters. The page lists topics in this order.
 */
export const FAQ_TOPICS = [
  { id: 'tickets-and-entry', label: 'Tickets & entry' },
  { id: 'paying-by-bkash', label: 'Paying by bKash' },
  { id: 'orders-and-holds', label: 'Orders & holds' },
  { id: 'changes-and-refunds', label: 'Changes & refunds' },
] as const;
export type FaqTopicId = (typeof FAQ_TOPICS)[number]['id'];

export type FaqEntry = FaqItem & { topic: FaqTopicId };
import { HOLD_HOURS, REGISTRATION_CLOSES_DAYS_BEFORE } from './site';

/**
 * A7 FAQ copy. Order matters: the questions people actually ask, most
 * common first. Ids are the shareable anchors (`/faq#wrong-trxid`) — treat
 * them as permanent once published. A function of the verification promise
 * (B14 settings) so the FAQ quotes what the organizer actually promised.
 */
export const faqItems = (verificationPromise: string): FaqEntry[] => [
  {
    id: 'when-do-tickets-arrive',
    topic: 'tickets-and-entry',
    question: 'How long until my tickets arrive?',
    answer: (
      <p>
        A person checks your bKash transaction against the statement — {verificationPromise}. When
        it matches, the tickets are emailed straight away and your order page updates itself. If
        something is wrong you get an email explaining what to do.
      </p>
    ),
  },
  {
    id: 'wrong-trxid',
    topic: 'paying-by-bkash',
    question: 'I typed the wrong TrxID. What now?',
    answer: (
      <>
        <p>
          Open your order page (the link in your email, or{' '}
          <Link href="/orders/find">Find my order</Link>) and check the status. While it still says{' '}
          <strong>Checking payment</strong>, you can correct the transaction ID and the number you
          sent from and submit again.
        </p>
        <p>
          If the order was already rejected, the seats have gone back on sale. If the money never
          left your account, simply register again. If it did, send a screenshot of the bKash
          receipt to the organizer (see <Link href="/contact">Contact</Link>) — the payment is
          matched to a new order, or returned as the <Link href="/refund">refund policy</Link>{' '}
          describes.
        </p>
      </>
    ),
  },
  {
    id: 'someone-else',
    topic: 'changes-and-refunds',
    question: 'Can someone else use my ticket?',
    answer: (
      <p>
        Yes. Every ticket carries a name, and you can change it on the ticket page (the link in your
        tickets email) until registration closes {REGISTRATION_CLOSES_DAYS_BEFORE} days before the
        event. After that the names are fixed. At the door they need the ticket — its QR, or the
        ticket code — nothing else.
      </p>
    ),
  },
  {
    id: 'print',
    topic: 'tickets-and-entry',
    question: 'Do I need to print anything?',
    answer: (
      <p>
        No. Show the QR on your phone and it is scanned at the door. No signal, or a flat battery?
        Give your ticket code, or your name — then staff ask for the last 3 digits of the phone
        number that bought the ticket. A printable PDF is on every ticket page for people who prefer
        paper.
      </p>
    ),
  },
  {
    id: 'screenshot',
    topic: 'tickets-and-entry',
    question: 'Can I show a screenshot of my ticket?',
    answer: (
      <p>
        Yes. A screenshot of the QR scans the same as the ticket page. Each ticket admits one
        person, once — the first scan wins — so do not post or share it: if a copy is scanned before
        you arrive, the ticket has already been used. To pass a ticket on, send it to that one
        person and change the name on its ticket page.
      </p>
    ),
  },
  {
    id: 'no-card-payment',
    topic: 'paying-by-bkash',
    question: 'Why is there no card payment?',
    answer: (
      <p>
        This is a small operation. bKash is what nearly everyone here already has, it settles
        instantly, and it lets us keep ticket prices where they are instead of adding a card
        processor&apos;s fee. A person checks each payment, which is also why tickets take a little
        while to arrive.
      </p>
    ),
  },
  {
    id: 'hold-expired',
    topic: 'orders-and-holds',
    question: 'My hold expired but I sent the money',
    answer: (
      <p>
        Tickets are held for {HOLD_HOURS} hours from registration. If you sent the money but did not
        submit the TrxID in time, message the organizer with your order reference and the TrxID —
        see <Link href="/contact">Contact</Link>. If tickets are still available, the payment is
        matched to a new order for you; if the event sold out in the meantime, the money is returned
        by bKash transfer (see the <Link href="/refund">refund policy</Link>).
      </p>
    ),
  },
  {
    id: 'find-my-order',
    topic: 'orders-and-holds',
    question: 'I closed the page. How do I get back to my order?',
    answer: (
      <p>
        Every order page is linked from the email we send when you register. Without the email, use{' '}
        <Link href="/orders/find">Find my order</Link> with your order reference and the mobile
        number you registered with, or <Link href="/account/sign-in">sign in with your email</Link>{' '}
        to see every order you have placed. No password is needed — we email you a link.
      </p>
    ),
  },
];
