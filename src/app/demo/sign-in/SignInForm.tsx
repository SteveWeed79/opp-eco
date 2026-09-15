"use client";

import { useState, useTransition } from "react";
import { KeyRound, Mail } from "lucide-react";
import { Button, TextField, useToast } from "@/components/ui";
import { requestCode, submitCode } from "@/auth/actions";

/**
 * Two steps: an address, then the code that arrives at it.
 *
 * The first step's success message is deliberately the same whether or not the
 * address matched anything. Sign-on is the one page anyone can reach, and an
 * honest "no such account" is a free directory of who takes part in this
 * programme — including which public employees work on it.
 *
 * The exception is a *federated* organization, which is told plainly. That is
 * not a leak: the person needs to know to go to their agency's login, and how
 * an institution arranges its identity is not a secret about any individual.
 */
export function SignInForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function ask() {
    if (!email.includes("@")) return;
    setRefusal(null);
    startTransition(async () => {
      const result = await requestCode(email);
      if (result.ok) {
        setSent(true);
        toast.show("success", "If that address has an account, a code is on its way.");
      } else {
        // Shown in place rather than as a toast: a federated organization's
        // message is an instruction to go somewhere else, and it should stay on
        // screen while the person reads it.
        setRefusal(result.error ?? "Could not send a code.");
      }
    });
  }

  function verify() {
    if (code.trim().length === 0) return;
    startTransition(async () => {
      const result = await submitCode(email, code);
      // A success redirects, so reaching here at all means it failed.
      if (result && !result.ok) toast.show("error", result.error ?? "That code is not valid.");
    });
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Work email"
        type="email"
        value={email}
        autoComplete="email"
        disabled={sent}
        onChange={(event) => setEmail(event.target.value)}
        hint="The address your organization knows you by."
        onKeyDown={(event) => {
          if (event.key === "Enter" && !sent) ask();
        }}
      />

      {refusal && (
        <p className="text-sm text-crit-700 flex items-start gap-2">
          <KeyRound className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{refusal}</span>
        </p>
      )}

      {!sent ? (
        <Button
          variant="primary"
          onClick={ask}
          disabled={pending || !email.includes("@")}
        >
          {pending ? "Sending…" : "Email me a code"}
        </Button>
      ) : (
        <>
          <TextField
            label="Code"
            value={code}
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={12}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            hint="Eight characters, good for ten minutes, usable once."
            onKeyDown={(event) => {
              if (event.key === "Enter") verify();
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={verify} disabled={pending || !code.trim()}>
              {pending ? "Checking…" : "Sign in"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSent(false);
                setCode("");
              }}
              disabled={pending}
            >
              Use a different address
            </Button>
          </div>
        </>
      )}

      <p className="text-xs text-ink-500 flex items-start gap-2 pt-2">
        <Mail className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          There is no password to forget, and none stored. A code is the whole
          credential, and it expires in minutes.
        </span>
      </p>
    </div>
  );
}
