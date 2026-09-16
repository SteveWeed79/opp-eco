"use client";

import { useState, useTransition } from "react";
import { Wallet } from "lucide-react";
import { Button, Modal, TextField, TextAreaField, useToast } from "@/components/ui";

/**
 * Changing what the fund holds.
 *
 * This control is the point of the whole funding model. An allocation is not a
 * constant that happens to be stored — a supplemental award arrives, a
 * rescission takes some back, a board revises its rate between cohorts. When
 * the figure lived on the market as a fixture it could only change by a
 * redeploy, which meant in practice it never changed and every screen quoted a
 * number nobody had revisited.
 *
 * The reason is required, and that is not ceremony. A board's allocation moving
 * from $240,000 to $198,000 is a fact somebody explains to a funder eighteen
 * months later, and "the number is different now" is not an explanation.
 */
export function AdjustAllocation({
  sourceId,
  fundName,
  allocated,
  ratePerHour,
  committed,
  action,
}: {
  sourceId: string;
  fundName: string;
  allocated: number;
  /** Absent on a fund that does not pay by the hour, which hides the field. */
  ratePerHour?: number;
  /** Shown as the floor below which the fund becomes overcommitted. */
  committed: number;
  action: (
    sourceId: string,
    allocated: unknown,
    ratePerHour: unknown,
    reason: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [nextAllocated, setNextAllocated] = useState(String(allocated));
  const [nextRate, setNextRate] = useState(ratePerHour ? String(ratePerHour) : "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const parsedAllocated = Number(nextAllocated);
  const valid =
    Number.isFinite(parsedAllocated) && parsedAllocated >= 0 && reason.trim().length > 0;
  // Not a block — the service allows it deliberately, because a rescission is
  // real. Named before the fact rather than discovered afterwards.
  const wouldOvercommit = Number.isFinite(parsedAllocated) && parsedAllocated < committed;

  function close() {
    setOpen(false);
    setNextAllocated(String(allocated));
    setNextRate(ratePerHour ? String(ratePerHour) : "");
    setReason("");
  }

  function confirm() {
    if (!valid) return;
    startTransition(async () => {
      const result = await action(
        sourceId,
        parsedAllocated,
        ratePerHour !== undefined && nextRate !== "" ? Number(nextRate) : undefined,
        reason.trim(),
      );
      if (result.ok) {
        close();
        toast.show("success", `${fundName} updated.`);
      } else {
        toast.show("error", result.error ?? "Could not change the allocation.");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        Adjust
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Adjust ${fundName}`}
        description="Allocations move during a program year. Record what it is now and why, so the change is explainable later."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!valid || pending}>
              {pending ? "Saving…" : "Save the change"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          <TextField
            label="Allocation"
            type="number"
            min={0}
            step={1000}
            value={nextAllocated}
            onChange={(event) => setNextAllocated(event.target.value)}
            hint="Whole dollars for the program year."
          />
          {ratePerHour !== undefined && (
            <TextField
              label="Rate per hour"
              type="number"
              min={1}
              step={1}
              value={nextRate}
              onChange={(event) => setNextRate(event.target.value)}
              hint="Applies to new commitments only."
            />
          )}
        </div>

        <div className="mt-4">
          <TextAreaField
            label="Why it is changing"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Goes in the audit log beside the old and new figures."
          />
        </div>

        {wouldOvercommit && (
          <p className="mt-4 text-xs text-crit-700 flex items-start gap-2">
            <Wallet className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              This is below the ${committed.toLocaleString()} already committed,
              so the fund will show as overcommitted. That is allowed — a cut
              allocation is a real thing, and hiding it would leave the console
              showing a figure you know is wrong.
            </span>
          </p>
        )}
      </Modal>
    </>
  );
}
