"use client";

import { Calendar } from "lucide-react";

/**
 * Pick an appointment time, grouped by day.
 *
 * A flat list of timestamps is unreadable past a handful; grouping by day is
 * how people actually scan availability. Used for board interview slots, and
 * intended for any future scheduling — a midpoint check-in, a credit review.
 */

export interface Slot {
  id: string;
  startsAt: string;
  durationMinutes: number;
  /** Who is running the session, shown so the choice is informed. */
  host?: string;
  disabled?: boolean;
}

export function SlotPicker({
  slots,
  value,
  onChange,
  label = "Available times",
  emptyMessage = "No times are currently published.",
}: {
  slots: Slot[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
  emptyMessage?: string;
}) {
  if (slots.length === 0) {
    return (
      <p className="text-sm text-ink-500 flex items-center gap-2">
        <Calendar className="w-4 h-4" aria-hidden="true" />
        {emptyMessage}
      </p>
    );
  }

  const byDay = new Map<string, Slot[]>();
  for (const slot of slots) {
    const day = new Date(slot.startsAt).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }

  return (
    <fieldset>
      <legend className="block text-xs font-bold text-ink-700 uppercase tracking-wider mb-3">
        {label}
      </legend>
      <div className="space-y-4">
        {Array.from(byDay.entries()).map(([day, daySlots]) => (
          <div key={day}>
            <p className="text-sm font-bold text-ink-950 mb-2">{day}</p>
            <div className="flex flex-wrap gap-2">
              {daySlots.map((slot) => {
                const selected = slot.id === value;
                const at = new Date(slot.startsAt);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={slot.disabled}
                    onClick={() => onChange(slot.id)}
                    aria-pressed={selected}
                    title={slot.host ? `with ${slot.host}` : undefined}
                    className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-line-strong bg-white text-ink-950 hover:border-brand-700"
                    }`}
                  >
                    {at.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    <span
                      className={`block text-xs font-normal ${
                        selected ? "text-brand-100" : "text-ink-500"
                      }`}
                    >
                      {slot.durationMinutes} min
                      {slot.host ? ` · ${slot.host}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
