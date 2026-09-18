"use client";

import { useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, ChoiceGroup, Modal, TextAreaField, useToast } from "@/components/ui";
import { ESCALATION_KINDS, MIN_SUMMARY } from "@/domain/escalation";

/**
 * The control that says a placement has gone wrong.
 *
 * Shared by all five portals, each passing its own Server Action with its role
 * pinned server-side — the same arrangement `RecordOutcome` and
 * `IntroduceStudent` use. Rendering is not authorization: the service checks
 * again, and an actor naming a placement they cannot see is refused there
 * rather than here.
 *
 * **The reassurance in the dialog is load-bearing, not decoration.** A learner
 * deciding whether to report an absent supervisor is weighing it against having
 * to work beside that supervisor tomorrow, and the honest answer — that the
 * employer cannot read this — is the only thing that makes the button worth
 * putting on the page. It is true because `escalationScope` and
 * `visibleEscalations` make it true, so the sentence and the query say the same
 * thing and the tests hold them together.
 *
 * Deliberately quiet in the layout. This is not an action anybody should be
 * nudged into taking, and a prominent red button on a healthy placement invites
 * the noise that makes a queue worthless.
 */
export function RaiseProblem({
  applicationId,
  placementTitle,
  action,
  label = "Report a problem",
}: {
  applicationId: string;
  /** What the placement is, so the dialog can say what it is about. */
  placementTitle: string;
  action: (
    applicationId: string,
    kind: string,
    summary: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** The administrator is writing down somebody else's call, not reporting. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function close() {
    setOpen(false);
    setKind(null);
    setSummary("");
  }

  function confirm() {
    if (!kind) return;
    startTransition(async () => {
      const result = await action(applicationId, kind, summary);
      if (result.ok) {
        close();
        toast.show(
          "success",
          "Reported. An administrator will pick this up — nobody else on the placement can see it.",
        );
      } else {
        toast.show("error", result.error ?? "Could not send that.");
      }
    });
  }

  const short = summary.trim().length > 0 && summary.trim().length < MIN_SUMMARY;

  return (
    <>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Report a problem"
        description={`About ${placementTitle}. This goes to an administrator, and to nobody else on the placement.`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!kind || short || !summary.trim() || pending}
            >
              {pending ? "Sending…" : "Send to an administrator"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="What kind of problem"
          value={kind}
          onChange={setKind}
          options={ESCALATION_KINDS.map((k) => ({
            value: k.value,
            label: k.label,
            description: k.description,
          }))}
        />

        <div className="mt-4">
          <TextAreaField
            label="What has gone wrong"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={5}
            required
            hint="Whoever picks this up has only what you write here, so say as much as you can — what happened, when, and who else knows."
            error={short ? "Say a little more than that." : undefined}
          />
        </div>

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          Anything where somebody is at risk should be reported here even if you
          are not sure. Reporting it does not pause your placement, and you can
          withdraw a report yourself if it turns out to be nothing.
        </p>
      </Modal>
    </>
  );
}
