"use client";

import { useState, useTransition } from "react";
import { Compass } from "lucide-react";
import {
  Button,
  ChoiceGroup,
  Modal,
  TextAreaField,
  TextField,
  useToast,
} from "@/components/ui";

/**
 * The control that turns a finished placement into a measured one.
 *
 * The lifecycle ends at credit granted, which says the experience worked. This
 * is the only thing in the product that says whether the *venture* did — and
 * because it takes a year of follow-ups to answer, the record has to exist
 * before there is anything to put in it.
 *
 * Shared by the college and, when it gets a surface, the administrator: each
 * passes its own Server Action with its role pinned server-side, exactly as
 * `IntroduceStudent` does. Rendering is not authorization, and the same checks
 * run again inside the action.
 */
export interface OutcomeChoice {
  value: string;
  label: string;
  meta: string;
  description: string;
}

export function RecordOutcome({
  studentId,
  applicationId,
  studentName,
  placementTitle,
  choices,
  action,
}: {
  studentId: string;
  applicationId: string;
  studentName: string;
  placementTitle: string;
  choices: OutcomeChoice[];
  action: (
    studentId: string,
    applicationId: string,
    kind: string,
    observedOn: string,
    detail?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  // Defaults to today, which is what a follow-up made on the call actually is.
  // Editable because the other common case is writing up a conversation from
  // last week, and a date silently stamped "today" would file it in the wrong
  // quarter.
  const [observedOn, setObservedOn] = useState(() => today());
  const [detail, setDetail] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function close() {
    setOpen(false);
    setKind(null);
    setObservedOn(today());
    setDetail("");
  }

  function confirm() {
    if (!kind) return;
    startTransition(async () => {
      const result = await action(
        studentId,
        applicationId,
        kind,
        new Date(`${observedOn}T12:00:00`).toISOString(),
        detail.trim() || undefined,
      );
      if (result.ok) {
        close();
        toast.show("success", `Recorded. ${studentName} is measured.`);
      } else {
        toast.show("error", result.error ?? "Could not record that.");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        Record outcome
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`What did ${studentName} do next?`}
        description={`Following ${placementTitle}. One answer per finished experience — a later follow-up adds to this rather than replacing it.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!kind || pending}>
              {pending ? "Recording…" : "Record it"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="Where are they now"
          value={kind}
          onChange={setKind}
          options={choices}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2 items-start">
          <TextField
            label="True as of"
            type="date"
            value={observedOn}
            max={today()}
            onChange={(event) => setObservedOn(event.target.value)}
            hint="The date this was the case, not the date you are entering it."
          />
        </div>

        <div className="mt-4">
          <TextAreaField
            label="Detail"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            hint="Optional. The employer, the institution, the programme. The workforce board sees the answer above but never this."
          />
        </div>

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <Compass className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            &ldquo;Still looking&rdquo; is a real answer and worth recording. A
            learner nobody asked is counted separately, so an unworked queue can
            never read as a bad result.
          </span>
        </p>
      </Modal>
    </>
  );
}

/** Today as `YYYY-MM-DD`, which is what a date input takes. */
function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
