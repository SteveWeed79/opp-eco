"use client";

import { useState, useTransition } from "react";
import { AtSign, ShieldCheck, UserPlus } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  SelectField,
  TextField,
  useToast,
} from "@/components/ui";

/**
 * Who can get into an organization, and under what address.
 *
 * Two forms rather than one screen with a mode, because they are two different
 * conversations. Adding somebody is routine onboarding. Moving an address is a
 * person on the phone who cannot get in, and it is the one control here that
 * hands an account to a different mailbox — so it asks for a reason, says what
 * it is about to do, and says who gets told.
 *
 * Neither form offers a list of people to pick from. The administrator is
 * working from what somebody told them, and a browsable directory of every
 * account is exactly what the sign-on design spends its effort not being.
 */

interface Choice {
  id: string;
  name: string;
  domains: string[];
}

export function Access({
  organizations,
  add,
  move,
}: {
  organizations: Choice[];
  add: (
    organizationId: unknown,
    name: unknown,
    email: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
  move: (
    currentEmail: unknown,
    newEmail: unknown,
    reason: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AddMember organizations={organizations} add={add} />
      <MoveAddress move={move} />
    </div>
  );
}

function AddMember({
  organizations,
  add,
}: {
  organizations: Choice[];
  add: (
    organizationId: unknown,
    name: unknown,
    email: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const chosen = organizations.find((o) => o.id === organizationId);
  const domains = chosen?.domains ?? [];

  function submit() {
    if (!organizationId || !name.trim() || !email.trim()) return;
    startTransition(async () => {
      const result = await add(organizationId, name, email);
      if (result.ok) {
        toast.show("success", `${name.trim()} can now sign in with their own address.`);
        setName("");
        setEmail("");
      } else {
        toast.show("error", result.error ?? "Could not add that person.");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        level={3}
        icon={<UserPlus className="w-5 h-5" />}
        title="Add somebody to an organization"
        subtitle="Their own account, on their own work address"
      />
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          One account is one person. A board with four officers is four accounts
          — what makes an eligibility determination attributable is that the
          record names an individual, and it stops being attributable the moment
          an office shares a login.
        </p>

        <SelectField
          label="Organization"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
          options={organizations.map((o) => ({ value: o.id, label: o.name }))}
        />
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="As it should appear against everything they decide."
        />
        <TextField
          label="Work email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint={
            domains.length > 0
              ? `Must be on ${domains.join(" or ")} — a personal address cannot be used.`
              : "This organization has declared no work domains, so any address is accepted."
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={pending || !organizationId || !name.trim() || !email.trim()}
        >
          {pending ? "Adding…" : "Add person"}
        </Button>

        {domains.length === 0 && organizations.length > 0 && (
          <p className="text-xs text-warn-700 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              With no declared domains there is nothing stopping an account being
              created on a mailbox somebody here controls. Declaring them is what
              turns this form into a control rather than a convenience.
            </span>
          </p>
        )}
      </div>
    </Card>
  );
}

function MoveAddress({
  move,
}: {
  move: (
    currentEmail: unknown,
    newEmail: unknown,
    reason: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [currentEmail, setCurrentEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const ready = currentEmail.trim() && newEmail.trim() && reason.trim();

  function submit() {
    if (!ready) return;
    startTransition(async () => {
      const result = await move(currentEmail, newEmail, reason);
      if (result.ok) {
        toast.show("success", "Address moved. The old one has been told.");
        setCurrentEmail("");
        setNewEmail("");
        setReason("");
      } else {
        toast.show("error", result.error ?? "Could not change that address.");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        level={3}
        icon={<AtSign className="w-5 h-5" />}
        title="Move a work address"
        subtitle="When somebody's mailbox is gone and they cannot get in"
      />
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          The recovery path for an agency address that changed. On the code path
          there is no password to fall back on, so without this the person is
          locked out for good.
        </p>

        <TextField
          label="Address on the account now"
          type="email"
          value={currentEmail}
          onChange={(event) => setCurrentEmail(event.target.value)}
          hint="What they signed in with before. Ask them."
        />
        <TextField
          label="New work address"
          type="email"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          hint="Must be on a domain their organization has declared."
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Recorded against the account permanently."
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button variant="primary" onClick={submit} disabled={pending || !ready}>
          {pending ? "Moving…" : "Move address"}
        </Button>

        <p className="text-xs text-ink-500 flex items-start gap-2 pt-1">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Every session ends and every code in flight stops working. The old
            address is told what happened and who did it — which is the part that
            reaches a person if this was not their idea.
          </span>
        </p>
      </div>
    </Card>
  );
}
