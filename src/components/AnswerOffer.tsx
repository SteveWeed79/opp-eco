"use client";

import { useState, useTransition } from "react";
import { Compass } from "lucide-react";
import {
  Button,
  ChoiceGroup,
  Modal,
  TextAreaField,
  useToast,
} from "@/components/ui";

/**
 * The one question only the employer can answer.
 *
 * Deliberately the smallest control in this product. The employer is not being
 * asked to grade the placement or to describe where the learner went — it is
 * being asked what it did, which it already knows, and the answer is three
 * options and a button. Every field added here is a reason for somebody who
 * would have clicked to close the tab instead.
 *
 * Shared by the employer and the administrator, each passing its own Server
 * Action with its role pinned server-side, exactly as `RecordOutcome` is.
 * Rendering is not authorization and the same checks run again in the service.
 */
export interface OfferChoice {
  value: string;
  label: string;
  meta: string;
  description: string;
}

export function AnswerOffer({
  applicationId,
  studentName,
  placementTitle,
  choices,
  action,
}: {
  applicationId: string;
  studentName: string;
  placementTitle: string;
  choices: OfferChoice[];
  action: (
    applicationId: string,
    answer: string,
    note?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function close() {
    setOpen(false);
    setAnswer(null);
    setNote("");
  }

  function confirm() {
    if (!answer) return;
    startTransition(async () => {
      const result = await action(applicationId, answer, note.trim() || undefined);
      if (result.ok) {
        close();
        toast.show(
          "success",
          answer === "accepted"
            ? `Recorded. ${studentName} counts as staying in the region.`
            : "Recorded. Thank you — that one is genuinely useful.",
        );
      } else {
        toast.show("error", result.error ?? "Could not record that.");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        Answer
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Did you offer ${studentName} a job?`}
        description={`After ${placementTitle}. Nobody else can answer this one — a college can tell us somebody is working, but not what you decided.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!answer || pending}>
              {pending ? "Recording…" : "Record it"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="What happened"
          value={answer}
          onChange={setAnswer}
          options={choices}
        />

        {answer && answer !== "accepted" && (
          <div className="mt-4">
            <TextAreaField
              label="Anything worth knowing"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              hint="Optional, and never shown to the learner. Headcount, timing, fit — the thing a town would want to know, which a tick box cannot hold."
            />
          </div>
        )}

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <Compass className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            &ldquo;We made no offer&rdquo; is a normal result for an internship
            and not a mark against you. What it is not is the same as never
            being asked — those are counted separately, which is the only reason
            this question is worth your thirty seconds.
          </span>
        </p>
      </Modal>
    </>
  );
}
