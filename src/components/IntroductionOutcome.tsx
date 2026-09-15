"use client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

/**
 * Closing an introduction, which is the half that keeps capacity honest.
 *
 * A live introduction occupies one of a mentor's declared places. Left open
 * forever it drains that capacity to zero over a year of mentorships that in
 * fact finished, so saying what happened is not bookkeeping — it is what lets
 * the next student be introduced.
 *
 * The note is required on both outcomes. "It did not happen" with no reason
 * tells a college nothing about whether to try that mentor again, and "it
 * happened" with no reason is the only evidence this platform will ever hold
 * that a mentorship took place.
 */
type Outcome = "met" | "declined";

const COPY: Record<Outcome, { label: string; title: string; description: string }> = {
  met: {
    label: "It happened",
    title: "Record that the mentorship happened",
    description:
      "This is the only record that it took place. Say briefly what the student got out of it.",
  },
  declined: {
    label: "It did not happen",
    title: "Record that it did not happen",
    description:
      "The place goes back to the mentor. Say why, so the college knows whether to try them again.",
  },
};

export function IntroductionOutcome({
  pairingId,
  studentName,
  action,
}: {
  pairingId: string;
  studentName: string;
  action: (
    pairingId: string,
    to: Outcome,
    note: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [choosing, setChoosing] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function confirm(note: string) {
    const outcome = choosing;
    if (!outcome) return;
    startTransition(async () => {
      const result = await action(pairingId, outcome, note);
      if (result.ok) {
        setChoosing(null);
        toast.show(
          "success",
          outcome === "met"
            ? `Recorded. ${studentName}'s mentorship is on the record.`
            : "Recorded. The mentor has their place back.",
        );
      } else {
        toast.show("error", result.error ?? "Could not record that.");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(COPY) as Outcome[]).map((outcome) => (
        <Button
          key={outcome}
          size="sm"
          variant={outcome === "met" ? "quiet" : "ghost"}
          onClick={() => setChoosing(outcome)}
        >
          {COPY[outcome].label}
        </Button>
      ))}

      <ConfirmDialog
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        onConfirm={(note) => confirm(note ?? "")}
        title={choosing ? COPY[choosing].title : ""}
        description={choosing ? COPY[choosing].description : ""}
        confirmLabel={choosing ? COPY[choosing].label : "Confirm"}
        tone={choosing === "declined" ? "danger" : "normal"}
        reason={{ required: true, label: "What happened" }}
        pending={pending}
      />
    </div>
  );
}
