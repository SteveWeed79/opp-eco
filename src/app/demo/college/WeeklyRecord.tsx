"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TimeEntry } from "@/domain/types";

/**
 * The weekly record behind an hours total, for the college awarding credit.
 *
 * Academic credit is a judgement about work done, not about hours billed — a
 * registrar signing off 132 hours has to be able to say what those hours were.
 * The board, which is pricing a claim rather than judging the work, does not
 * get this; the repository strips the summaries before they reach it.
 *
 * Collapsed by default because the credit queue is a list of people to work
 * through, and expanding every one of them by default turns a queue into a
 * document.
 */
export function WeeklyRecord({ entries }: { entries: TimeEntry[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const approved = entries.filter((entry) => entry.status === "approved");
  if (approved.length === 0) return null;

  return (
    <span className="inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-ink-950 transition-colors"
      >
        {approved.length} week{approved.length === 1 ? "" : "s"}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul id={panelId} className="mt-2 space-y-1.5 max-w-md">
          {approved.map((entry) => (
            <li key={entry.id} className="text-xs border-l-2 border-brand-200 pl-2.5">
              <span className="text-ink-700 font-semibold tabular">
                {formatWeek(entry.weekStarting)} · {entry.hours} hrs
              </span>
              <span className="block text-ink-600">{entry.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

function formatWeek(monday: string): string {
  return new Date(`${monday}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
