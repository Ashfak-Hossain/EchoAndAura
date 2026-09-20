import type { Metadata } from 'next';
import Link from 'next/link';
import { findOrderAction } from './actions';
import { FindOrderForm } from './find-form';

export const metadata: Metadata = { title: 'Find my order', robots: { index: false } };

/**
 * The way back for a buyer who closed the tab before paying. No account
 * needed: the reference (which they put in the bKash payment) plus the
 * phone they registered with. Signing in by email is the other route.
 */
export default function FindOrderPage() {
  return (
    <div className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-6 px-4 py-8 lg:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.02em]">
          Find my order
        </h1>
        <p className="text-[15px] leading-relaxed text-[#4a4640]">
          Closed the page before paying? Enter your order reference and the mobile number you
          registered with, and we&apos;ll take you straight back to it.
        </p>
      </header>
      <FindOrderForm action={findOrderAction} />
      <p className="text-sm text-muted-foreground">
        Prefer email?{' '}
        <Link href="/account/sign-in" className="underline">
          Sign in with your email
        </Link>{' '}
        to see every order you have placed.
      </p>
    </div>
  );
}
