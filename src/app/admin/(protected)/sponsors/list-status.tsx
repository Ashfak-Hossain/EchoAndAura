'use client';

import {
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

type Announce = (message: string) => void;

// Outside a list (the edit form's delete) there is nothing to announce into.
const AnnounceContext = createContext<Announce>(() => {});

// Outside a list there is no status line to move focus to.
const RegionContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** Say something in the list's status line: "Order saved.", "Bhor FM is now hidden." */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}

/**
 * The status line itself, for a control that removes its own row (delete):
 * focus has to land somewhere that outlives the row, or it falls to <body>
 * and a keyboard or screen-reader user starts again from the top.
 */
export function useStatusRegion(): RefObject<HTMLDivElement | null> | null {
  return useContext(RegionContext);
}

/**
 * B15's one status line, above the groups. It starts with the server's
 * banner (`?saved=` / `?deleted=`) and is replaced by whatever a row
 * control last did. The region is always in the page — a live region that
 * appears together with its text is often not read out — and each message
 * is a fresh node, so "Order saved." twice in a row is announced twice.
 */
export function ListStatus({ initial, children }: { initial: string | null; children: ReactNode }) {
  const [message, setMessage] = useState(initial === null ? null : { text: initial, id: 0 });
  const region = useRef<HTMLDivElement>(null);
  const announce = useCallback<Announce>(
    (text) => setMessage((m) => ({ text, id: (m?.id ?? 0) + 1 })),
    [],
  );

  return (
    <AnnounceContext.Provider value={announce}>
      <RegionContext.Provider value={region}>
        {/* Empty, it is taken out of the flow (no stray gap) but not hidden.
          tabIndex -1: focus is placed here programmatically, never tabbed to. */}
        <div ref={region} role="status" tabIndex={-1} className="outline-none empty:absolute">
          {message ? (
            <p
              key={message.id}
              className="rounded-lg border border-[#bfe0cd] bg-success-tint px-3.5 py-2.5 text-sm font-semibold text-[#17603b]"
            >
              {message.text}
            </p>
          ) : null}
        </div>
        {children}
      </RegionContext.Provider>
    </AnnounceContext.Provider>
  );
}
