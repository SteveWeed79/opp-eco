"use client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

/**
 * The buttons that move a record through a state machine.
 *
 * One component for every portal and every machine, because the server decides
 * *which* moves exist — `availableTransitions` for applications, and the
 * equivalent on each lifecycle machine. This only renders them and reports what
 * happened. A portal cannot invent a button the domain does not offer, and
 * adding a transition to a table makes it appear everywhere it applies without
 * touching a page.
 *
 * Rendering is not authorization. The same check runs again inside the action,
 * because a Server Action accepts a direct POST and the absence of a button
 * proves nothing about what a caller can attempt.
 */

export interface TransitionOption {
  to: string;
  label: string;
}

/**
 * Two different reasons to stop and ask, deliberately not conflated.
 *
 * **`needsReason`** — the reason is the substance of the move. "Request
 * changes" with no note is a posting bounced back to an employer who cannot
 * tell what to change; the text is the whole message.
 *
 * **`destructive`** — the move ends something, so the dialog is styled as a
 * warning and the copy says it is on the record permanently.
 *
 * They overlap for applications, which is why one set served both at first.
 * They come apart the moment a college requests changes: that needs a reason
 * and is not destructive, and dressing it in red would misdescribe a routine
 * step of review as something to be avoided.
 */
export interface ConfirmPolicy {
  needsReason: ReadonlySet<string>;
  destructive: ReadonlySet<string>;
}

const APPLICATION_ENDINGS = new Set([
  "rejected",
  "withdrawn",
  "terminated_early",
  "credit_denied",
  "unsubsidized",
  "closed",
]);

export const APPLICATION_CONFIRM: ConfirmPolicy = {
  needsReason: APPLICATION_ENDINGS,
  destructive: APPLICATION_ENDINGS,
};

/**
 * A rejected verification is not an ending — a student who was not enrolled
 * last term may be this one, and the machine lets them resubmit. But the
 * reason is what they have to act on, so it is required either way.
 */
export const STUDENT_CONFIRM: ConfirmPolicy = {
  needsReason: new Set(["verification_rejected", "inactive"]),
  destructive: new Set(["inactive"]),
};

/**
 * "Request changes" carries the whole message and is a routine step of review,
 * so it asks for a reason without being dressed as a warning. Closing and
 * expiring genuinely end a posting.
 */
export const POSTING_CONFIRM: ConfirmPolicy = {
  needsReason: new Set(["changes_requested", "closed", "expired"]),
  destructive: new Set(["closed", "expired"]),
};

/**
 * Every vetting refusal reaches a real organization waiting on an answer, so
 * all three carry a reason. Only rejection and suspension stop them.
 */
export const ORGANIZATION_CONFIRM: ConfirmPolicy = {
  needsReason: new Set(["info_requested", "rejected", "suspended"]),
  destructive: new Set(["rejected", "suspended"]),
};

export function TransitionActions({
  id,
  transitions,
  action,
  size = "sm",
  subject,
  confirm = APPLICATION_CONFIRM,
}: {
  id: string;
  transitions: TransitionOption[];
  /** The portal's own Server Action. Each pins its role server-side. */
  action: (
    id: string,
    to: string,
    reason?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  size?: "sm" | "md";
  /** What is being acted on, for the confirmation copy. */
  subject?: string;
  /** Which moves stop to ask, and which of those are endings. */
  confirm?: ConfirmPolicy;
}) {
  const [confirming, setConfirming] = useState<TransitionOption | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  if (transitions.length === 0) return null;

  function run(option: TransitionOption, reason?: string) {
    startTransition(async () => {
      const result = await action(id, option.to, reason);
      if (result.ok) {
        setConfirming(null);
        toast.show("success", `${option.label} — done.`);
      } else {
        // The dialog stays open on failure so the reason typed into it is not
        // lost to a rejection the person can do something about.
        toast.show("error", result.error ?? "That didn't go through.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {transitions.map((option) => {
          const asks = confirm.needsReason.has(option.to);
          return (
            <Button
              key={option.to}
              size={size}
              variant={confirm.destructive.has(option.to) ? "ghost" : "primary"}
              disabled={pending}
              onClick={() => (asks ? setConfirming(option) : run(option))}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={(reason) => confirming && run(confirming, reason)}
        title={confirming?.label ?? ""}
        description={describe(confirming, subject, confirm)}
        confirmLabel={confirming?.label}
        tone={
          confirming && confirm.destructive.has(confirming.to) ? "danger" : "normal"
        }
        pending={pending}
        reason={{
          label: "Reason",
          hint:
            confirming && confirm.destructive.has(confirming.to)
              ? "Everyone who can see this record will see why it ended here."
              : "This is sent to whoever has to act on it, so say what needs to change.",
          required: true,
        }}
      />
    </>
  );
}

/**
 * The confirmation copy.
 *
 * An ending is permanent and says so. A move that merely needs a reason is
 * routine, and telling someone requesting a change to a posting that it
 * "cannot be undone" would make a normal step of review sound alarming.
 */
function describe(
  option: TransitionOption | null,
  subject: string | undefined,
  confirm: ConfirmPolicy,
): string {
  if (!option) return "";

  const prefix = subject ? `${subject}. ` : "";
  return confirm.destructive.has(option.to)
    ? `${prefix}This is recorded in the audit log and cannot be undone.`
    : `${prefix}This is recorded in the audit log and the reason is sent on.`;
}
