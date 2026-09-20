import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPublicSession } from '@/lib/session';
import { requestSignInLinkAction } from './actions';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Passwordless: the first sign-in creates the account. Never required to buy. */
export default async function SignInPage() {
  const session = await getPublicSession();
  if (session?.role === 'buyer') redirect('/account');
  return (
    <div className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-6 px-4 py-8 lg:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.02em]">
          Sign in
        </h1>
        <p className="text-[15px] leading-relaxed text-[#4a4640]">
          See every order and ticket you have with us. You never need an account to buy — this is
          just the easy way back.
        </p>
      </header>
      <SignInForm action={requestSignInLinkAction} />
      <p className="text-sm text-muted-foreground">
        No email to hand?{' '}
        <Link href="/orders/find" className="underline">
          Find one order
        </Link>{' '}
        by its reference and your phone number.
      </p>
    </div>
  );
}
