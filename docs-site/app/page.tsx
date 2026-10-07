import Link from 'next/link';

export default function Home() {
  return (
    <main className="welcome">
      <p className="eyebrow">ECHO & AURA · DEVELOPER DOCUMENTATION</p>
      <h1>
        A real system.
        <br />
        The reasoning behind it.
      </h1>
      <p>
        Understand how a ticket reservation, a manual payment, and a background job fit together.
        Follow the explanations into the code and tests.
      </p>
      <Link href="/docs/">Explore the system →</Link>
    </main>
  );
}
