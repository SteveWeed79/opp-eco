"use client";

import { useState, useTransition } from "react";
import { PackageCheck } from "lucide-react";
import { Button, Modal, TextAreaField, useToast } from "@/components/ui";
import { MIN_SUMMARY } from "@/domain/deliverable";

/**
 * The micro track's central act, which the product has never had.
 *
 * `Application.deliverableSubmitted` has guarded the employer's *Accept
 * deliverable* transition since the first migration and was written only by the
 * seed — so the gate existed and this is the thing that opens it.
 *
 * **The dialog says what acceptance means, because the learner cannot see the
 * employer's side.** Handing in is not "finished": it starts somebody else's
 * decision, and that decision is also the evaluation the college reads when it
 * awards the credit. A learner who thinks they have finished and hears nothing
 * for a week is the failure this sentence is trying to prevent.
 *
 * A resubmission uses the same control with a different label, because it is
 * the same act — the round is the server's business, not a second button.
 */
export function HandInWork({
  applicationId,
  projectTitle,
  /** What they were asked to change, when this is a second go. */
  revisionAsked,
  round,
  action,
}: {
  applicationId: string;
  projectTitle: string;
  revisionAsked?: string;
  round?: number;
  action: (
    applicationId: string,
    summary: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const again = Boolean(revisionAsked);

  function close() {
    setOpen(false);
    setSummary("");
  }

  function confirm() {
    startTransition(async () => {
      const result = await action(applicationId, summary);
      if (result.ok) {
        close();
        toast.show(
          "success",
          again
            ? "Handed in again. The employer has been told."
            : "Handed in. The employer has been told.",
        );
      } else {
        toast.show("error", result.error ?? "Could not hand that in.");
      }
    });
  }

  const short = summary.trim().length > 0 && summary.trim().length < MIN_SUMMARY;

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        {again ? "Hand in again" : "Hand in your work"}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={again ? "Hand in the revised work" : "Hand in your work"}
        description={`${projectTitle}. The employer reads this and either takes the work or tells you what to change.`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!summary.trim() || short || pending}
            >
              {pending ? "Sending…" : "Hand it in"}
            </Button>
          </>
        }
      >
        {revisionAsked && (
          <div className="mb-4 rounded-xl border border-warn-100 bg-warn-50 p-4">
            <p className="text-xs font-semibold text-ink-950">
              What they asked for{round ? ` after round ${round}` : ""}
            </p>
            <p className="mt-1 text-sm text-ink-700 whitespace-pre-line">
              {revisionAsked}
            </p>
          </div>
        )}

        <TextAreaField
          label="What you are handing in"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={5}
          required
          hint="What you did and what they should look at first. This is what the employer sees before anything else."
          error={short ? "Say a little more than that." : undefined}
        />

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <PackageCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          Handing in does not finish the placement — the employer accepting it
          does, and what they write when they accept is the evaluation your
          college reads when it awards the credit.
        </p>
      </Modal>
    </>
  );
}
