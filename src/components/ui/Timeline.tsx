import type { ReactNode } from "react";

/**
 * Chronological history.
 *
 * Built for an application's audit trail, which is the answer to "why is this
 * placement where it is?" — a question the administrator will ask constantly
 * and currently has to reconstruct from a flat log.
 *
 * Rendered as an ordered list so the sequence is conveyed structurally, not
 * only by the connecting line.
 */

export interface TimelineEntry {
  id: string;
  /** Displayed as the heading for this step. */
  title: ReactNode;
  at: string;
  actor?: string;
  detail?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "crit";
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-500">No history recorded yet.</p>;
  }

  const dots = {
    neutral: "bg-ink-400",
    good: "bg-good-600",
    warn: "bg-warn-600",
    crit: "bg-crit-600",
  };

  return (
    <ol className="relative">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        return (
          <li key={entry.id} className="relative pl-7 pb-5 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className="absolute left-[5px] top-3 bottom-0 w-px bg-ink-200"
              />
            )}
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full ring-4 ring-white ${
                dots[entry.tone ?? "neutral"]
              }`}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-semibold text-ink-950">{entry.title}</p>
              <time
                dateTime={entry.at}
                className="text-xs text-ink-500 tabular whitespace-nowrap"
              >
                {new Date(entry.at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
            </div>
            {entry.actor && (
              <p className="text-xs text-ink-500 mt-0.5">{entry.actor}</p>
            )}
            {entry.detail && (
              <div className="text-xs text-ink-600 mt-1.5">{entry.detail}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
