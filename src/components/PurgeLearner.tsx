"use client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

/**
 * Removing a learner's direct identifiers under the retention schedule.
 *
 * A per-learner button against a list the console computes, rather than a sweep
 * that runs unattended. Anonymisation is irreversible, the clock depends on
 * activity dates, and the first time an automatic purge runs it runs against
 * everything at once — a person pressing this is how you find out the schedule
 * is wrong while that is still cheap.
 *
 * The reason is required for the same argument the funding adjustment makes:
 * this is the kind of act somebody has to account for later, and the moment to
 * capture why is the moment it happens.
 */
export function PurgeLearner({
  studentId,
  learnerLabel,
  action,
}: {
  studentId: string;
  learnerLabel: string;
  action: (
    studentId: string,
    reason: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function confirm(reason: string) {
    startTransition(async () => {
      const result = await action(studentId, reason);
      if (result.ok) {
        setOpen(false);
        toast.show("success", "Identifiers removed. The placement record is intact.");
      } else {
        toast.show("error", result.error ?? "Could not purge that record.");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Purge identity
      </Button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={(reason) => confirm(reason ?? "")}
        title={`Remove ${learnerLabel}'s identifiers`}
        description="Their name, email, skills and interests go. The placement, the hours and the credit stay, so every figure already reported to a board still reconciles. This cannot be undone."
        confirmLabel="Purge the identity"
        tone="danger"
        reason={{ required: true, label: "Why this record is being purged" }}
        pending={pending}
      />
    </>
  );
}
