"use client";

import { useState, useTransition } from "react";
import { Button, useToast } from "@/components/ui";
import { applyToPosting } from "./actions";

/**
 * Applying, which until now was a button that did nothing.
 *
 * On success the card disappears — recommendations exclude postings already
 * applied to — so the `applied` state exists only to cover the window between
 * the action returning and the revalidated page arriving. Without it a second
 * click lands in that gap. The server refuses the duplicate anyway; this stops
 * the interface from inviting one.
 */
export function ApplyButton({
  postingId,
  title,
}: {
  postingId: string;
  title: string;
}) {
  const [applied, setApplied] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function apply() {
    startTransition(async () => {
      const result = await applyToPosting(postingId);
      if (result.ok) {
        setApplied(true);
        toast.show("success", `Applied to ${title}. The employer has been notified.`);
      } else {
        toast.show("error", result.error ?? "Could not submit that application.");
      }
    });
  }

  return (
    <Button
      size="sm"
      variant={applied ? "ghost" : "primary"}
      onClick={apply}
      disabled={applied || pending}
    >
      {applied ? "Applied" : pending ? "Applying…" : "Apply"}
    </Button>
  );
}
