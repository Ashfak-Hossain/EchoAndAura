'use client';

/**
 * The door must never dead-end on the generic error page mid-rush: one big
 * button reloads the scanner (the pass cookie survives a reload).
 */
export default function DoorError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
      <h1 className="font-heading text-3xl text-white">The scanner hit a problem</h1>
      <p className="text-[15px] leading-relaxed text-white/75">
        Reload it — you stay signed in to this gate. If it keeps happening, use the printed list and
        tell the organizer.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="h-14 rounded-xl bg-[#eda43c] text-lg font-bold text-[#1c1a17]"
      >
        Reload the scanner
      </button>
      <button type="button" onClick={reset} className="h-12 text-[15px] text-white/60 underline">
        Try without reloading
      </button>
    </main>
  );
}
