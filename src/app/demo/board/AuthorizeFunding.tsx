"use client";

import { useState, useTransition } from "react";
import { Button, Modal, TextField, useToast } from "@/components/ui";
import { authorizeFunding } from "./actions";

/**
 * Authorizing funding is not a one-click transition, because it commits money.
 *
 * The board is deciding *how many hours* to guarantee against a finite annual
 * allocation, and the default — the posting's full hours — is a proposal, not a
 * foregone conclusion. Making the number visible and editable before it is
 * committed is the difference between an authorization and an accident.
 *
 * The rate is shown but not editable: it is the market's negotiated
 * reimbursement rate, not a per-placement decision. The server ignores any rate
 * sent with the request for the same reason.
 */
export function AuthorizeFunding({
  applicationId,
  studentName,
  defaultHours,
  ratePerHour,
  remainingBudget,
}: {
  applicationId: string;
  studentName: string;
  defaultHours: number;
  ratePerHour: number;
  remainingBudget: number;
}) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(String(defaultHours));
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const parsed = Number(hours);
  const valid = Number.isInteger(parsed) && parsed > 0;
  const commitment = valid ? parsed * ratePerHour : 0;
  const overBudget = commitment > remainingBudget;

  function submit() {
    startTransition(async () => {
      const result = await authorizeFunding(applicationId, parsed);
      if (result.ok) {
        setOpen(false);
        toast.show(
          "success",
          `Authorized ${parsed} hours for ${studentName}. The employer has been notified.`,
        );
      } else {
        toast.show("error", result.error ?? "Could not authorize that.");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Authorize funding
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Authorize funding"
        description={`Commit board funds for ${studentName}'s placement.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!valid || overBudget || pending}
              title={
                overBudget
                  ? "This exceeds the remaining allocation"
                  : !valid
                    ? "Enter a whole number of hours"
                    : undefined
              }
            >
              {pending ? "Authorizing…" : "Authorize"}
            </Button>
          </>
        }
      >
        <TextField
          label="Hour cap"
          hint="The most this placement can bill against the allocation."
          type="number"
          min={1}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          error={
            !valid
              ? "Enter a whole number of hours."
              : overBudget
                ? `$${commitment.toLocaleString()} exceeds the $${remainingBudget.toLocaleString()} remaining this program year.`
                : undefined
          }
        />

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-600">Rate</dt>
            <dd className="font-semibold text-ink-950 tabular">
              ${ratePerHour}/hr
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-600">Maximum commitment</dt>
            <dd
              className={`font-bold tabular ${overBudget ? "text-crit-700" : "text-ink-950"}`}
            >
              ${commitment.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-600">Remaining after this</dt>
            <dd className="font-semibold text-ink-950 tabular">
              ${Math.max(0, remainingBudget - commitment).toLocaleString()}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-ink-500">
          This is a cap, not a payment. The placement bills against it as hours
          are approved, and anything unused returns to the allocation.
        </p>
      </Modal>
    </>
  );
}
