"use client";

import { useState, useTransition } from "react";
import { GraduationCap } from "lucide-react";
import { Button, Modal, TextAreaField, useToast } from "@/components/ui";
import { MIN_RESPONSE } from "@/domain/deliverable";

/**
 * The employer's half of the micro track: take the work, or say what to change.
 *
 * **Accepting is the evaluation, and the dialog says so.** On this track there
 * is no timesheet and no supervisor sign-off — the employer taking the work is
 * the whole assessment, and the note they write is the academic record the
 * college reads when it awards the credit. An employer who thinks they are
 * clicking a receipt writes "thanks", and a registrar is later asked to award
 * credit on the strength of it.
 *
 * Two buttons rather than one with a toggle, because they are different
 * decisions with different consequences: one completes a placement, the other
 * hands the work back and leaves it running.
 */
export function AnswerHandIn({
  deliverableId,
  learnerName,
  projectTitle,
  summary,
  round,
  accept,
  requestRevision,
}: {
  deliverableId: string;
  learnerName: string;
  projectTitle: string;
  /** What the learner said they handed in. */
  summary: string;
  round: number;
  accept: (
    deliverableId: string,
    evaluation: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  requestRevision: (
    deliverableId: string,
    response: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [mode, setMode] = useState<"accept" | "revise" | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function close() {
    setMode(null);
    setNote("");
  }

  function confirm() {
    if (!mode) return;
    startTransition(async () => {
      const result =
        mode === "accept"
          ? await accept(deliverableId, note)
          : await requestRevision(deliverableId, note);
      if (result.ok) {
        close();
        toast.show(
          "success",
          mode === "accept"
            ? `Accepted. ${learnerName}'s placement is complete and their college can award the credit.`
            : `Sent back to ${learnerName} with what you asked for.`,
        );
      } else {
        toast.show("error", result.error ?? "Could not record that.");
      }
    });
  }

  const short =
    mode === "revise" && note.trim().length > 0 && note.trim().length < MIN_RESPONSE;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => setMode("accept")}>
          Accept the work
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("revise")}>
          Ask for a change
        </Button>
      </div>

      <Modal
        open={mode !== null}
        onClose={close}
        title={mode === "accept" ? "Accept the work" : "Ask for a change"}
        description={
          mode === "accept"
            ? `${projectTitle} — accepting completes ${learnerName}'s placement.`
            : `${projectTitle} — this goes back to ${learnerName} and the placement keeps running.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!note.trim() || short || pending}
            >
              {pending
                ? "Saving…"
                : mode === "accept"
                  ? "Accept it"
                  : "Send it back"}
            </Button>
          </>
        }
      >
        <div className="mb-4 rounded-xl border border-line bg-ink-50 p-4">
          <p className="text-xs font-semibold text-ink-950">
            What they handed in{round > 1 ? ` · round ${round}` : ""}
          </p>
          <p className="mt-1 text-sm text-ink-700 whitespace-pre-line">{summary}</p>
        </div>

        <TextAreaField
          label={mode === "accept" ? "Your assessment of the work" : "What needs changing"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          required
          hint={
            mode === "accept"
              ? "A sentence on what was good and what they should know. The college reads this when it awards the credit."
              : "Be specific — this is the only instruction they get, and a vague one costs a week."
          }
          error={short ? "Say a little more than that." : undefined}
        />

        {mode === "accept" && (
          <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
            <GraduationCap className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            There is no timesheet on a micro-internship and no separate
            evaluation form — what you write here <strong>is</strong> the
            evaluation, and it is the whole of what the college has to go on.
          </p>
        )}
      </Modal>
    </>
  );
}
