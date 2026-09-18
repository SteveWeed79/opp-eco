"use client";

import { useState, useTransition } from "react";
import { Button, Modal, TextAreaField, useToast } from "@/components/ui";

/**
 * The administrator's two moves on a reported problem.
 *
 * **Acknowledge** is one click and exists for the raiser rather than for the
 * administrator: somebody who reported an absent supervisor and has heard
 * nothing for three days does not know whether the report arrived, and the
 * cheapest thing the platform can do about that is say somebody has it.
 *
 * **Resolve** asks what was done, and will not take an empty answer — the same
 * rule closing a mentorship follows, for the same reason. This record is the
 * only account the programme will ever hold of the problem, and "resolved" on
 * its own tells the next person nothing about whether to trust that employer
 * with another learner.
 */
export function ResolveProblem({
  escalationId,
  acknowledged,
  acknowledge,
  resolve,
}: {
  escalationId: string;
  /** Already picked up, so only the closing move is offered. */
  acknowledged: boolean;
  acknowledge: (escalationId: string) => Promise<{ ok: boolean; error?: string }>;
  resolve: (
    escalationId: string,
    resolution: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function pickUp() {
    startTransition(async () => {
      const result = await acknowledge(escalationId);
      if (result.ok) toast.show("success", "Picked up. Whoever raised it can see that.");
      else toast.show("error", result.error ?? "Could not pick that up.");
    });
  }

  function close() {
    setOpen(false);
    setResolution("");
  }

  function confirm() {
    startTransition(async () => {
      const result = await resolve(escalationId, resolution);
      if (result.ok) {
        close();
        toast.show("success", "Closed out.");
      } else {
        toast.show("error", result.error ?? "Could not close that.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!acknowledged && (
        <Button size="sm" variant="quiet" onClick={pickUp} disabled={pending}>
          {pending ? "…" : "Pick it up"}
        </Button>
      )}
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        Close it out
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Close this out"
        description="What was done about it. This is the only record the programme will hold of how this ended."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!resolution.trim() || pending}
            >
              {pending ? "Closing…" : "Close it out"}
            </Button>
          </>
        }
      >
        <TextAreaField
          label="What was done"
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          rows={4}
          required
          hint="Who you spoke to, what changed, and whether it is safe to place another learner there."
        />
      </Modal>
    </div>
  );
}
