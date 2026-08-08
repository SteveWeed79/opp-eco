"use client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";
import type { ApplicationStatus } from "@/domain/types";

/**
 * The buttons that move an application.
 *
 * One component for all five portals, because there is one state machine. The
 * server decides *which* moves exist by calling `availableTransitions`; this
 * only renders them and reports what happened. A portal cannot invent a button
 * the domain does not offer, and adding a transition to the table makes it
 * appear everywhere it applies without touching a page.
 *
 * Rendering is not authorization. The same check runs again inside the action,
 * because a Server Action accepts a direct POST and the absence of a button
 * proves nothing about what a caller can attempt.
 */

export interface TransitionOption {
  to: ApplicationStatus;
  label: string;
}

/** Moves that end something, and so need confirming and a reason on the record. */
const IRREVERSIBLE: ReadonlySet<ApplicationStatus> = new Set([
  "rejected",
  "withdrawn",
  "terminated_early",
  "credit_denied",
  "unsubsidized",
  "closed",
]);

export function TransitionActions({
  applicationId,
  transitions,
  action,
  size = "sm",
  subject,
}: {
  applicationId: string;
  transitions: TransitionOption[];
  /** The portal's own Server Action. Each pins its role server-side. */
  action: (
    applicationId: string,
    to: string,
    reason?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  size?: "sm" | "md";
  /** What is being acted on, for the confirmation copy. */
  subject?: string;
}) {
  const [confirming, setConfirming] = useState<TransitionOption | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  if (transitions.length === 0) return null;

  function run(option: TransitionOption, reason?: string) {
    startTransition(async () => {
      const result = await action(applicationId, option.to, reason);
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
          const destructive = IRREVERSIBLE.has(option.to);
          return (
            <Button
              key={option.to}
              size={size}
              variant={destructive ? "ghost" : "primary"}
              disabled={pending}
              onClick={() =>
                destructive ? setConfirming(option) : run(option)
              }
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
        description={
          subject
            ? `${subject}. This is recorded in the audit log and cannot be undone.`
            : "This is recorded in the audit log and cannot be undone."
        }
        confirmLabel={confirming?.label}
        tone="danger"
        pending={pending}
        reason={{
          label: "Reason",
          hint: "Everyone who can see this application will see why it ended here.",
          required: true,
        }}
      />
    </>
  );
}
