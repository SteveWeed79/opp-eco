import { Card, Skeleton, SkeletonCard, SkeletonRows } from "@/components/ui";

/**
 * Shared loading shape for the portals.
 *
 * Deliberately mirrors the real layout — a page header, a row of stat tiles,
 * then a table — so content arrives into the space already reserved for it
 * rather than shoving the page down. A skeleton whose proportions do not match
 * the thing it stands in for is worse than a spinner: it promises a layout and
 * then breaks it.
 *
 * Does nothing today because fixtures resolve instantly. It exists for the
 * database swap, when every one of these lists gains real latency.
 */
export function PortalLoading({
  stats = 4,
  rows = 5,
}: {
  stats?: number;
  rows?: number;
}) {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <Card className="px-8 py-7 space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-3 w-56" />
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: stats }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <Card>
        <div className="px-6 pt-5 pb-4 border-b border-line space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <SkeletonRows rows={rows} columns={5} />
      </Card>
    </div>
  );
}
