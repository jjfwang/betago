/**
 * 404 Not Found page.
 */

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface-muted text-ink-DEFAULT">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-ink-muted">Page not found.</p>
      <Link href="/" className="btn">
        Back to game
      </Link>
    </div>
  );
}
