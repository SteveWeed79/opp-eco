"use client";

import { useState, useTransition } from "react";
import { HandCoins } from "lucide-react";
import {
  Button,
  ChoiceGroup,
  Modal,
  TextAreaField,
  TextField,
  useToast,
} from "@/components/ui";

/**
 * Promising money from a fund to a learner.
 *
 * This is the control the whole funding model was built for. The student
 * survey's top barrier to taking a placement is the tuition a learner pays to
 * receive credit for work a board is already subsidising — and before these
 * records existed there was nowhere to put either the cost or the grant that
 * covered it. A foundation could pay it; the platform could not say so.
 *
 * Deliberately not a generic "spend money" form. It names one fund, one
 * learner, and one placement, because a commitment that cannot say who it is
 * for is a transfer rather than a grant.
 */
export interface FundableLearner {
  /** `studentId:applicationId`, so one value carries the whole choice. */
  value: string;
  label: string;
  meta: string;
  description: string;
}

export function AwardFunds({
  sourceId,
  fundName,
  remaining,
  learners,
  action,
}: {
  sourceId: string;
  fundName: string;
  remaining: number;
  learners: FundableLearner[];
  action: (
    sourceId: string,
    studentId: string,
    applicationId: string | null,
    amount: number,
    note: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const parsed = Number(amount);
  const valid = who !== null && Number.isInteger(parsed) && parsed > 0;
  // Shown before submitting rather than returned as a refusal afterwards. The
  // service refuses it either way — this just means nobody has to find out the
  // hard way.
  const overFund = Number.isFinite(parsed) && parsed > remaining;

  function close() {
    setOpen(false);
    setWho(null);
    setAmount("");
    setNote("");
  }

  function confirm() {
    if (!valid || !who) return;
    const [studentId, applicationId] = who.split(":");
    startTransition(async () => {
      const result = await action(
        sourceId,
        studentId,
        applicationId || null,
        parsed,
        note.trim(),
      );
      if (result.ok) {
        close();
        toast.show("success", `Committed from ${fundName}.`);
      } else {
        toast.show("error", result.error ?? "Could not commit that.");
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => setOpen(true)}
        disabled={learners.length === 0 || remaining <= 0}
      >
        {remaining <= 0 ? "Nothing left" : "Award"}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Award from ${fundName}`}
        description={`$${remaining.toLocaleString()} uncommitted. A commitment names the learner it is for, so the fund can report who it reached.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!valid || overFund || pending}
            >
              {pending ? "Committing…" : "Commit it"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="Which learner"
          value={who}
          onChange={setWho}
          options={learners}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2 items-start">
          <TextField
            label="Amount"
            type="number"
            min={1}
            step={50}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            hint="Whole dollars."
            error={overFund ? "More than this fund has left." : undefined}
          />
        </div>

        <div className="mt-4">
          <TextAreaField
            label="What it covers"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Optional, and the only place the reason will ever be recorded."
          />
        </div>

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <HandCoins className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            A commitment is a promise, not a payment. It holds the money against
            this learner until it is disbursed or released, and the fund&rsquo;s
            remaining balance moves the moment you confirm.
          </span>
        </p>
      </Modal>
    </>
  );
}
