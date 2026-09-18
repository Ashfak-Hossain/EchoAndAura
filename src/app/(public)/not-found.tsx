import { ButtonLink } from '@/components/button-link';

// A8 404 (minimal; the full A8 lands with the static-pages slice).
export default function PublicNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-160 flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">404</p>
      <h1 className="text-3xl">That page isn&apos;t here</h1>
      <p className="max-w-md text-[15px] text-muted-foreground">
        The link may be old, or the event isn&apos;t public yet. Upcoming events are on the home
        page.
      </p>
      <ButtonLink href="/" variant="secondary">
        See upcoming events
      </ButtonLink>
    </main>
  );
}
