"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

/**
 * Sortable table.
 *
 * Exists because the candidate pipeline, the stalled queue, and the board's
 * desk each hand-rolled their own header row, sort state, and empty message.
 * Sorting is announced through `aria-sort` so the current order is available
 * to a screen reader, not only to someone who can see the arrow.
 */

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Value to sort by. Omit to make the column unsortable. */
  sortValue?: (row: Row) => string | number;
  align?: "left" | "right";
  /** Hide below the `sm` breakpoint, for columns that are nice-to-have. */
  secondary?: boolean;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  empty = "Nothing here yet.",
  rowTone,
  caption,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  empty?: ReactNode;
  /** Row-level emphasis, e.g. highlighting what is stuck. */
  rowTone?: (row: Row) => "warn" | "crit" | undefined;
  caption?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (left === right) return 0;
      return left > right ? factor : -factor;
    });
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-8">
        <div className="rounded-card border border-dashed border-line-strong bg-sunken/60 px-6 py-8 text-center text-sm text-ink-500">
          {empty}
        </div>
      </div>
    );
  }

  // A left rail rather than a wash across the whole row. The tint alone was
  // too weak to survive next to the badges it sits beside, and strengthening
  // it would have fought the status colours in the cells.
  const tones = {
    warn: "bg-warn-50/50 shadow-[inset_3px_0_0_var(--color-warn-600)]",
    crit: "bg-crit-50/50 shadow-[inset_3px_0_0_var(--color-crit-600)]",
  };

  return (
    // `scroll-x` fades the edge when a table is wider than its card, which is
    // how the board's action column used to simply vanish mid-button.
    <div className="scroll-x">
      <table className="w-full border-separate border-spacing-0">
        {caption && <caption className="sr-only">{caption}</caption>}
        {/* Sticky, so the column meanings survive a long queue. */}
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const sortable = Boolean(column.sortValue);
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={`py-2.5 px-4 text-[0.7rem] font-extrabold text-ink-500 uppercase tracking-[0.1em] whitespace-nowrap bg-canvas/80 backdrop-blur-sm border-b border-line ${
                    column.align === "right" ? "text-right" : "text-left"
                  } ${column.secondary ? "hidden sm:table-cell" : ""}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className="inline-flex items-center gap-1.5 hover:text-ink-950 transition-colors uppercase"
                    >
                      {column.header}
                      {active ? (
                        sort!.dir === "asc" ? (
                          <ArrowUp className="w-3 h-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="w-3 h-3" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const tone = rowTone?.(row);
            return (
              <tr
                key={rowKey(row)}
                // Hover is what makes a wide row scannable — it ties a name on
                // the far left to an action on the far right, which is exactly
                // the reach these tables ask for.
                className={`transition-colors ${
                  tone ? tones[tone] : "hover:bg-canvas/60"
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`py-3.5 px-4 text-sm text-ink-700 border-b border-line/70 ${
                      column.align === "right" ? "text-right" : ""
                    } ${column.secondary ? "hidden sm:table-cell" : ""}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
