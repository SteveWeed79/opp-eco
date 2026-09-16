"use client";

import { useState, useTransition } from "react";
import { KeyRound, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, CardHeader, TextField, useToast } from "@/components/ui";
import type { EnrolmentOffer } from "@/services/mfa";

/**
 * Enrolling an authenticator.
 *
 * On the administrator's own console rather than in a settings area, because
 * there is no settings area and because this is the account the second factor
 * exists for — a learner signing in with a code to their college address is a
 * proportionate trade, and an administrator reading every market is not.
 *
 * The recovery codes appear once. They are stored as hashes, so there is no
 * path by which this screen could show them again, and it says so rather than
 * letting somebody close the panel and find out later.
 */
export function SecondFactor({
  enrolled,
  recoveryCodesLeft,
  start,
  finish,
  drop,
}: {
  enrolled: boolean;
  recoveryCodesLeft: number;
  start: () => Promise<{ ok: boolean; error?: string; offer?: EnrolmentOffer }>;
  finish: (
    code: unknown,
  ) => Promise<{ ok: boolean; error?: string; recoveryCodes?: string[] }>;
  drop: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [offer, setOffer] = useState<EnrolmentOffer | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function begin() {
    startTransition(async () => {
      const result = await start();
      if (result.ok && result.offer) setOffer(result.offer);
      else toast.show("error", result.error ?? "Could not start enrolment.");
    });
  }

  function confirm() {
    if (code.trim().length === 0) return;
    startTransition(async () => {
      const result = await finish(code);
      if (result.ok) {
        setOffer(null);
        setCode("");
        setRecoveryCodes(result.recoveryCodes ?? []);
        toast.show("success", "Authenticator enrolled.");
      } else {
        toast.show("error", result.error ?? "That code is not right.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await drop();
      if (result.ok) {
        setRecoveryCodes(null);
        toast.show("success", "Authenticator removed.");
      } else {
        toast.show("error", result.error ?? "Could not remove it.");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        level={2}
        icon={
          enrolled ? (
            <ShieldCheck className="w-5 h-5" />
          ) : (
            <ShieldAlert className="w-5 h-5" />
          )
        }
        title="Second factor"
        subtitle="This account reads every market and authorises money"
        action={
          <Badge tone={enrolled ? "good" : "warn"}>
            {enrolled ? "Enrolled" : "Not enrolled"}
          </Badge>
        }
      />

      <div className="px-6 py-5 space-y-4">
        {recoveryCodes && (
          <div className="rounded-card border border-warn-100 bg-warn-50 px-4 py-3">
            <p className="text-sm font-bold text-ink-950">
              Write these down now — they are not shown again
            </p>
            <p className="text-xs text-ink-600 mt-1">
              Each works once, and only if your authenticator is gone. They are
              stored as hashes, so nobody here can read them back to you.
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm text-ink-950">
              {recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>{recoveryCode}</li>
              ))}
            </ul>
          </div>
        )}

        {enrolled && !recoveryCodes && (
          <>
            <p className="text-sm text-ink-600">
              Sign-in asks for a code from your authenticator.{" "}
              {recoveryCodesLeft} recovery code
              {recoveryCodesLeft === 1 ? "" : "s"} left.
            </p>
            <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
              {pending ? "Removing…" : "Remove authenticator"}
            </Button>
          </>
        )}

        {!enrolled && !offer && (
          <>
            <p className="text-sm text-ink-600 leading-relaxed">
              A one-time code to a mailbox is a single factor, and the factor is
              the mailbox. Enrol an authenticator and sign-in will ask for both.
            </p>
            <Button variant="primary" onClick={begin} disabled={pending}>
              {pending ? "Starting…" : "Enrol an authenticator"}
            </Button>
          </>
        )}

        {offer && (
          <div className="space-y-3">
            <p className="text-sm text-ink-700">
              Add this to your authenticator app, then enter the code it shows.
            </p>
            <div className="rounded-card border border-line bg-canvas px-4 py-3">
              <p className="text-xs text-ink-500">Secret</p>
              <p className="font-mono text-sm text-ink-950 break-all">
                {offer.secret}
              </p>
              <p className="text-xs text-ink-500 mt-2">Or open this link on the phone</p>
              <p className="font-mono text-[11px] text-ink-600 break-all">{offer.uri}</p>
            </div>
            <TextField
              label="Code from the app"
              value={code}
              inputMode="numeric"
              maxLength={7}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirm();
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={confirm} disabled={pending || !code.trim()}>
                {pending ? "Checking…" : "Confirm"}
              </Button>
              <Button variant="ghost" onClick={() => setOffer(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-500 flex items-start gap-2 pt-1">
          <KeyRound className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Workforce board officers are not offered this. Their agency owns
            their identity, and their second factor is its business rather than
            something this platform should invent for a public employee.
          </span>
        </p>
      </div>
    </Card>
  );
}
