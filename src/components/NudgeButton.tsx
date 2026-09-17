"use client";

import { useTransition } from "react";
import { Button, useToast } from "@/components/ui";

/**
 * One row of the chase queue, sent.
 *
 * No modal and no confirm step, deliberately. The thing this sends is a short
 * standing message asking somebody a question they are already expected to
 * answer — the cost of an accidental one is that an employer reads a polite
 * nudge twice, which is not a cost worth a dialog. Compare `RecordOutcome`,
 * which writes a permanent observation and asks first.
 *
 * It stays enabled after sending. A second nudge three weeks later is the
 * normal way this works, and a button that disables itself would make the
 * administrator's most ordinary next action the one the screen fights.
 */
export function NudgeButton({
  applicationId,
  audience,
  label,
  sentMessage,
  action,
}: {
  applicationId: string;
  audience: "employer" | "learner";
  label: string;
  sentMessage: string;
  action: (
    applicationId: unknown,
    audience: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <Button
      size="sm"
      variant="quiet"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action(applicationId, audience);
          if (result.ok) toast.show("success", sentMessage);
          else toast.show("error", result.error ?? "Could not send that.");
        })
      }
    >
      {pending ? "Sending…" : label}
    </Button>
  );
}
