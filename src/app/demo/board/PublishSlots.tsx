"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, X } from "lucide-react";
import { Button, Modal, TextField, useToast } from "@/components/ui";

/**
 * Publishing a morning of interview slots.
 *
 * The control this replaces did nothing at all: the board's header carried a
 * raised, primary "Publish slots" button that swallowed the click, which meant
 * the eligibility interview — the step every subsidised placement waits on —
 * could only be scheduled by editing the fixtures.
 *
 * A date and a list of times rather than a list of full timestamps, because
 * that is how the work is actually described: an officer says "Tuesday, nine
 * to eleven, half-hour slots", not four ISO instants. The form generates the
 * instants; the server validates every one of them again.
 *
 * Times are local to whoever is filling this in. That is the honest reading of
 * a board officer typing "09:00" — they mean nine in Kansas — and the
 * conversion to an instant happens here, in the only place that knows the
 * browser's zone.
 */
export function PublishSlots({
  action,
}: {
  action: (
    startsAt: unknown,
    durationMinutes: unknown,
    officerName: unknown,
    meetingUrl: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [duration, setDuration] = useState("30");
  const [officerName, setOfficerName] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const filled = times.filter((t) => t.trim().length > 0);
  const valid = date !== "" && filled.length > 0 && officerName.trim().length >= 2;

  function close() {
    setOpen(false);
    setDate("");
    setTimes(["09:00"]);
    setDuration("30");
    setOfficerName("");
    setMeetingUrl("");
  }

  function confirm() {
    if (!valid) return;
    // `new Date("2026-04-02T09:00")` with no zone suffix is parsed as local
    // time, which is what was meant. Appending `Z` here would silently publish
    // a nine o'clock appointment at four in the morning.
    const instants = filled.map((time) => new Date(`${date}T${time}`).toISOString());

    startTransition(async () => {
      const result = await action(
        instants,
        Number(duration),
        officerName.trim(),
        meetingUrl.trim() || null,
      );
      if (result.ok) {
        const count = instants.length;
        close();
        toast.show("success", `${count} slot${count === 1 ? "" : "s"} published.`);
      } else {
        toast.show("error", result.error ?? "Could not publish those slots.");
      }
    });
  }

  return (
    <>
      <Button variant="dark" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Publish slots
        </span>
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Publish interview slots"
        description="Students book these themselves. Every subsidised placement waits on one, so an empty calendar is a queue."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!valid || pending}>
              {pending
                ? "Publishing…"
                : `Publish ${filled.length} slot${filled.length === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 items-start">
            <TextField
              label="Date"
              type="date"
              value={date}
              required
              onChange={(event) => setDate(event.target.value)}
              hint="Times below are in your own time zone."
            />
            <TextField
              label="Minutes each"
              type="number"
              min={15}
              max={120}
              step={5}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>

          <div>
            <p className="text-sm font-bold text-ink-950">Times</p>
            <p className="text-xs text-ink-500 mt-0.5">
              One row per appointment. An officer blocks out a morning, not a
              single slot.
            </p>
            <ul className="mt-3 space-y-2">
              {times.map((time, index) => (
                <li key={index} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={time}
                    aria-label={`Start time ${index + 1}`}
                    onChange={(event) => {
                      const next = [...times];
                      next[index] = event.target.value;
                      setTimes(next);
                    }}
                    className="bg-surface border border-line-strong rounded-card px-3 py-2 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {times.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove start time ${index + 1}`}
                      onClick={() => setTimes(times.filter((_, i) => i !== index))}
                      className="text-ink-500 hover:text-crit-600 p-1"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Offer the next slot at the end of the last one, because
                  // that is what somebody filling this in is about to type.
                  const last = times[times.length - 1] ?? "09:00";
                  const [h, m] = last.split(":").map(Number);
                  const minutes = h * 60 + m + (Number(duration) || 30);
                  const next = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
                  setTimes([...times, next]);
                }}
              >
                Add another time
              </Button>
            </div>
          </div>

          <TextField
            label="Officer sitting these"
            value={officerName}
            required
            onChange={(event) => setOfficerName(event.target.value)}
            hint="The person a student will meet — often not the person publishing the calendar."
          />

          <TextField
            label="Meeting link"
            value={meetingUrl}
            placeholder="https://…"
            onChange={(event) => setMeetingUrl(event.target.value)}
            hint="Optional. Leave empty for an in-person interview."
          />
        </div>
      </Modal>
    </>
  );
}
