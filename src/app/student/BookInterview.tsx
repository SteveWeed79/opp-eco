"use client";

import { useId, useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Button, ChoiceGroup, Modal, useToast } from "@/components/ui";
import type { InterviewSlot } from "@/domain/types";
import { bookInterviewSlot } from "./actions";

/**
 * The booking control that closes the pause.
 *
 * Slots are shown inline rather than behind a link, because the friction this
 * replaces is a student having to independently find a workforce board and
 * arrange a call — the step where placements are lost.
 */
export function BookInterview({
  applicationId,
  slots,
  boardName,
  ratePerHour,
}: {
  applicationId: string;
  slots: InterviewSlot[];
  boardName: string;
  ratePerHour: number;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(slots[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const headingId = useId();

  function confirm() {
    if (!selected) return;
    startTransition(async () => {
      const result = await bookInterviewSlot(applicationId, selected);
      if (result.ok) {
        setOpen(false);
        toast.show("success", "Interview booked. The board and employer have been notified.");
      } else {
        toast.show("error", result.error ?? "Could not book that slot.");
      }
    });
  }

  const formatSlot = (slot: InterviewSlot) => {
    const at = new Date(slot.startsAt);
    return {
      day: at.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      time: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    };
  };

  return (
    // A named region, not an anonymous div: this is the one action on the page
    // that matters, and a screen reader user navigating by landmark should be
    // able to reach it without reading the whole application card.
    <section
      aria-labelledby={headingId}
      className="mt-4 bg-warn-50 border border-warn-100 rounded-xl p-4"
    >
      <h4 id={headingId} className="text-sm font-semibold text-ink-950">
        Book your workforce board interview to unlock the ${ratePerHour}/hr wage
        reimbursement
      </h4>
      <p className="text-xs text-ink-600 mt-1">
        {boardName} needs a short conversation before this placement can be funded.
        Nothing moves until it&rsquo;s booked.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {slots.slice(0, 3).map((slot) => {
          const { day, time } = formatSlot(slot);
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => {
                setSelected(slot.id);
                setOpen(true);
              }}
              className="px-3 py-2 rounded-lg bg-white border border-warn-100 text-xs font-semibold text-ink-950 hover:border-brand-700 hover:text-brand-700 transition-colors"
            >
              {day} · {time}
            </button>
          );
        })}
        {slots.length > 3 && (
          <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
            See all {slots.length} times
          </Button>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Book your board interview"
        description={`${boardName} will confirm your eligibility for this placement.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!selected || pending}>
              {pending ? "Booking…" : "Confirm booking"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="Available times"
          value={selected}
          onChange={setSelected}
          options={slots.map((slot) => {
            const { day, time } = formatSlot(slot);
            return {
              value: slot.id,
              label: day,
              meta: time,
              description: `${slot.durationMinutes} minutes with ${slot.officerName}`,
            };
          })}
        />
        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          Booking notifies the board and your employer, and moves this
          application out of the queue it is currently stuck in.
        </p>
      </Modal>
    </section>
  );
}
