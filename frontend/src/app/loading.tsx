/**
 * Loading skeleton shown by Next.js while the root page suspends.
 */

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-muted">
      <p className="text-ink-muted text-sm animate-pulse">Loading BetaGo…</p>
    </div>
  );
}
