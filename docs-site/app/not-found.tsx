import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="welcome">
      <h1>Page not found</h1>
      <p>This page may have moved. Start with the system overview or use search.</p>
      <Link href="/docs/">Open the overview →</Link>
    </main>
  );
}
