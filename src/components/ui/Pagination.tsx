"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Page navigation.
 *
 * Every list in the app is currently unbounded, which is fine at twenty-six
 * applications and untenable at two thousand six hundred. The range summary
 * ("11–20 of 248") matters more than the buttons: it tells someone whether
 * scrolling further is worth it.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  label = "Results",
}: {
  /** 1-indexed. */
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-ink-100"
    >
      <p className="text-xs text-ink-500 tabular" aria-live="polite">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-1">
        <PageButton
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </PageButton>
        <span className="px-3 text-xs font-semibold text-ink-700 tabular">
          Page {page} of {pages}
        </span>
        <PageButton
          onClick={() => onChange(page + 1)}
          disabled={page >= pages}
          label="Next page"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="p-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

/** Slice rows for the current page. Kept here so callers cannot get it wrong. */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}
