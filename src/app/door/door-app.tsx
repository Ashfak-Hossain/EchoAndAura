'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type WireStatus, doorApi } from './door-api';
import { DoorSetup, OpenInBrowser } from './door-setup';
import { inAppBrowser, subscribeNever } from './platform';
import { Scanner } from './scanner';

export interface DoorInitial {
  passId: string;
  status: WireStatus;
}

const CODE_IN_HASH = /(?:^#|&)code=([^&]+)/;

/**
 * The /door page on the phone. The pass link is `/door#code=…`: a
 * fragment never reaches the server or its logs, and it is wiped from the
 * address bar as soon as it is read. Then: gate code form, or scanner.
 */
export function DoorApp({ initial }: { initial: DoorInitial | null }) {
  const router = useRouter();
  const inApp = useSyncExternalStore(
    subscribeNever,
    () => inAppBrowser(navigator.userAgent),
    () => null,
  );
  const [stayInApp, setStayInApp] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  /** A pass link that failed to open while this phone already scans for a gate. */
  const [linkError, setLinkError] = useState<string | null>(null);
  const scannerUp = useRef(false);
  useEffect(() => {
    scannerUp.current = initial !== null && !signedOut;
  }, [initial, signedOut]);

  const signedIn = useCallback(() => {
    setSignedOut(false);
    setMessage(null);
    router.refresh();
  }, [router]);

  const onSignedOut = useCallback((why: string) => {
    setSignedOut(true);
    setMessage(why);
  }, []);

  const signInWith = useCallback(
    async (code: string) => {
      // A phone already scanning keeps its scanner whatever this link does:
      // its own pass cookie is still good.
      const keepScanner = scannerUp.current;
      if (!keepScanner) setSigningIn(true);
      const reply = await doorApi.signIn(code);
      setSigningIn(false);
      if (reply.ok) {
        setLinkError(null);
        return signedIn();
      }
      const why =
        reply.kind === 'slow'
          ? `Too many tries from here — wait ${Math.ceil(reply.retryAfter / 60)} min.`
          : reply.kind === 'network'
            ? 'No connection. Check the signal, then open the pass link again.'
            : reply.message;
      if (keepScanner) {
        setLinkError(why);
        return;
      }
      setSignedOut(true);
      setMessage(why);
    },
    [signedIn],
  );

  useEffect(() => {
    const fromHash = () => {
      const match = CODE_IN_HASH.exec(window.location.hash);
      if (!match?.[1]) return;
      const code = decodeURIComponent(match[1]);
      setLinkCode(code);
      // Inside Messenger & co. nothing is signed in (the pass would live in
      // the app's own cookie jar) and the fragment stays, so the app's own
      // "Open in browser" carries the code; the card copies it too.
      if (inAppBrowser(navigator.userAgent)) return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      void signInWith(code);
    };
    // Deferred a tick so a double-run effect (dev) reads the hash only once.
    const timer = setTimeout(() => void fromHash(), 0);
    const onHash = () => void fromHash();
    window.addEventListener('hashchange', onHash);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', onHash);
    };
  }, [signInWith]);

  if (inApp && !stayInApp) {
    return (
      <OpenInBrowser
        app={inApp}
        code={linkCode}
        onContinue={() => {
          setStayInApp(true);
          if (!linkCode) return;
          window.history.replaceState(null, '', window.location.pathname);
          void signInWith(linkCode);
        }}
      />
    );
  }
  if (signingIn) {
    return (
      <main className="flex flex-1 items-center justify-center px-5">
        <p className="text-lg text-white">Opening the gate pass…</p>
      </main>
    );
  }
  if (!initial || signedOut) {
    return <DoorSetup message={message} onSignedIn={signedIn} />;
  }
  return (
    <>
      {linkError ? (
        <p role="status" className="bg-[#b86a00] px-4 py-2 text-sm text-white">
          That pass link did not open — {linkError} This phone is still on its current gate.
        </p>
      ) : null}
      <Scanner key={initial.passId} initial={initial.status} onSignedOut={onSignedOut} />
    </>
  );
}
