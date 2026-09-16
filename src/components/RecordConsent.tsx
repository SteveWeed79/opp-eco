"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import {
  Button,
  ChoiceGroup,
  Modal,
  TextAreaField,
  useToast,
} from "@/components/ui";

/**
 * Recording that a learner — or their parent — agreed to a disclosure.
 *
 * The grantor is asked rather than inferred, and that is the whole reason this
 * is a dialog instead of a button. FERPA rights transfer to the learner at 18
 * *or* on postsecondary enrolment at any age, so a dual-enrolled sixteen-year-old
 * consents for themselves on the college's records while their parent still
 * holds the school's — and one placement can generate both. Nothing on this
 * screen knows which applies, and guessing would put a wrong answer into the
 * one record that exists to prove the right one was obtained.
 */
export interface ConsentOption {
  value: string;
  label: string;
  meta: string;
  description: string;
}

export function RecordConsent({
  studentId,
  sourceOrgId,
  learnerLabel,
  institutionName,
  scopes,
  grantors,
  action,
}: {
  studentId: string;
  sourceOrgId: string;
  learnerLabel: string;
  institutionName: string;
  scopes: ConsentOption[];
  grantors: ConsentOption[];
  action: (
    studentId: string,
    sourceOrgId: string,
    scope: string,
    grantedBy: string,
    note: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string | null>(scopes[0]?.value ?? null);
  const [grantedBy, setGrantedBy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const valid = scope !== null && grantedBy !== null;

  function close() {
    setOpen(false);
    setScope(scopes[0]?.value ?? null);
    setGrantedBy(null);
    setNote("");
  }

  function confirm() {
    if (!scope || !grantedBy) return;
    startTransition(async () => {
      const result = await action(studentId, sourceOrgId, scope, grantedBy, note.trim());
      if (result.ok) {
        close();
        toast.show("success", "Consent recorded.");
      } else {
        toast.show("error", result.error ?? "Could not record that.");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        Record consent
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Record consent for ${learnerLabel}`}
        description={`Covers records held by ${institutionName}. A consent is attached to the institution whose records it is about, so this one authorises nothing another school holds.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!valid || pending}>
              {pending ? "Recording…" : "Record it"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="What was agreed to"
          value={scope}
          onChange={setScope}
          options={scopes}
        />

        <div className="mt-4">
          <ChoiceGroup
            label="Who signed"
            value={grantedBy}
            onChange={setGrantedBy}
            options={grantors}
            columns={2}
          />
        </div>

        <div className="mt-4">
          <TextAreaField
            label="What the form said"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Optional, and in the institution's own words. This is what you would produce if asked to show the consent."
          />
        </div>

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Without an education-record consent an employer sees an abbreviated
            name and no way to make contact, however far the placement has got.
          </span>
        </p>
      </Modal>
    </>
  );
}
