/**
 * Loading placeholders.
 *
 * Fixtures return instantly, so nothing in the demo needs these yet. Real
 * database latency turns every list into a blank flash, and a page that jumps
 * as content arrives reads as broken even when it is fast.
 *
 * Marked `aria-hidden` with a single live-region announcement at the container
 * level, so a screen reader hears "loading" once rather than a description of
 * every grey rectangle. The pulse respects `prefers-reduced-motion` through
 * the global rule in globals.css.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-ink-200 rounded animate-pulse ${className}`}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          // A ragged last line reads as text rather than as a block.
          className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="bg-white rounded-2xl border border-brand-100 p-6 space-y-3"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-ink-100">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-4">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? "w-40" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
