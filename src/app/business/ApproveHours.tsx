"use client";

import { useState, useTransition } from "react";
import { Button, TextAreaField, useToast } from "@/components/ui";
import { reviewPlacementHours } from "./actions";

/**
 * The supervisor's signature on a week.
 *
 * This is the only attestation in the system that the work happened, and a
 * workforce board reimburses public money against it. So approving is one
 * click and sending back is two — but the second step exists on the *reject*
 * path, not the approve one, because requiring a reason to approve would make
 * clearing a legitimate queue tedious enough that people stop reading.
 *
 * Sending back demands a reason. A week bounced without one leaves the student
 * unable to fix it, which turns a correction into an argument.
 */
export function ApproveHours({
  entryId,
  hours,
  studentName,
}: {
  entryId: string;
  hours: number;
  studentName: string;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function review(decision: "approve" | "reject") {
    startTransition(async () => {
      const result = await reviewPlacementHours(entryId, decision, note);
      if (result.ok) {
        setDone(decision === "approve" ? "approved" : "rejected");
        setRejecting(false);
        toast.show(
          "success",
          decision === "approve"
            ? `${hours} hours approved. ${studentName} has been told.`
            : `Sent back to ${studentName} with your note.`,
        );
      } else {
        toast.show("error", result.error ?? "Could not record that decision.");
      }
    });
  }

  // Covers the gap between the action returning and the revalidated page
  // arriving, so a second click cannot land on an already-reviewed week.
  if (done) {
    return (
      <span className="text-xs font-semibold text-ink-500">
        {done === "approved" ? "Approved" : "Sent back"}
      </span>
    );
  }

  if (rejecting) {
    return (
      <div className="w-full sm:w-80 space-y-2">
        <TextAreaField
          label="What needs correcting"
          required
          value={note}
          placeholder="These dates overlap with the week you already logged."
          onChange={(e) => setNote(e.target.value)}
          hint={`${studentName} sees this and can log the week again.`}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="danger"
            disabled={pending || note.trim().length === 0}
            onClick={() => review("reject")}
          >
            {pending ? "Sending…" : "Send back"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <span className="flex gap-2">
      <Button
        size="sm"
        variant="primary"
        disabled={pending}
        onClick={() => review("approve")}
      >
        {pending ? "Approving…" : "Approve"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
        Send back
      </Button>
    </span>
  );
}
