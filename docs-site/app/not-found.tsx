import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="welcome">
        <h1>Page not found</h1>
        <p>This page may have moved. Start with the system overview or use search.</p>
        <Link href="/docs/">Open the overview →</Link>
      </div>
    </HomeLayout>
  );
}
