/**
 * Global error boundary page for the App Router.
 *
 * Displayed when an unhandled error is thrown during rendering.
 * Provides a "Try again" button that re-mounts the subtree.
 */

"use client";

import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to an error tracking service in production.
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface-muted text-ink-DEFAULT">
      <h2 className="text-2xl font-bold">Something went wrong</h2>
      <p className="text-ink-muted text-sm max-w-sm text-center">
        {error.message ?? "An unexpected error occurred."}
      </p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
