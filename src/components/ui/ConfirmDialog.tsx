"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./primitives";
import { TextAreaField } from "./Field";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "normal" | "danger";
  /** Ask for a reason. Required reasons block confirmation until given. */
  reason?: { label: string; hint?: string; required?: boolean };
  pending?: boolean;
}

/**
 * Mounts the dialog only while open, so the reason field starts empty every
 * time. Clearing it in an effect instead would fire a cascading render, and a
 * stale reason silently attached to the next confirmation is worse than either.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmDialogBody {...props} />;
}

/**
 * Confirmation for moves that cannot be undone.
 *
 * Every irreversible transition in this system — declining a candidate,
 * terminating a placement, an administrator override — needs a reason captured
 * for the audit log. Making the reason part of the confirmation rather than a
 * separate step means the record is never written without it.
 */
function ConfirmDialogBody({
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "normal",
  reason,
  pending = false,
}: ConfirmDialogProps) {
  const [text, setText] = useState("");

  const blocked = reason?.required === true && text.trim().length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissOnBackdrop={tone !== "danger"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => onConfirm(reason ? text.trim() : undefined)}
            disabled={blocked || pending}
            title={blocked ? "A reason is required" : undefined}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {reason ? (
        <TextAreaField
          label={reason.label}
          hint={reason.hint}
          required={reason.required}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="This is recorded in the audit log."
        />
      ) : (
        <p className="text-sm text-ink-600">This cannot be undone.</p>
      )}
    </Modal>
  );
}
