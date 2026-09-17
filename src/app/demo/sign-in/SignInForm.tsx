"use client";

import { useState, useTransition } from "react";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { Button, TextField, useToast } from "@/components/ui";
import {
  changeOwnPassword,
  lookupSignInMethod,
  requestCode,
  requestReset,
  submitCode,
  submitPassword,
  submitReset,
  submitSecondFactor,
} from "@/auth/actions";
import type { IdentityMode } from "@/domain/types";

/**
 * One form, several doors.
 *
 * An address is asked for first and resolves to a method, so nobody is shown a
 * password field they cannot use. The resolution happens on the server and is
 * keyed on the address's **domain** rather than on whether the account exists —
 * so probing an agency's domain reveals how that agency signs in, which is an
 * institutional arrangement rather than a secret about a person, and reveals
 * nothing about which of its officers have accounts.
 *
 * Deliberately not a separate page per method. A dedicated "agency login" URL
 * is a good phishing target, and worse, it trains public employees to expect a
 * special address — which makes a convincing fake easier to fall for. "Go to
 * the site and type your work address" is the habit worth building.
 */

type Step =
  | { name: "address" }
  | { name: "password"; method: IdentityMode }
  | { name: "code" }
  | { name: "second-factor" }
  | { name: "reset-sent" }
  | { name: "must-change" };

/**
 * @param mustChange The session already exists and owes a password of its own.
 *   Server-resolved rather than a step this component walked to — a person who
 *   typed a portal URL instead of following the form gets here too, and client
 *   state knows nothing about that.
 */
export function SignInForm({ mustChange = false }: { mustChange?: boolean } = {}) {
  const [step, setStep] = useState<Step>(
    mustChange ? { name: "must-change" } : { name: "address" },
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function fail(message: string | undefined, fallback: string) {
    toast.show("error", message ?? fallback);
  }

  /** Step one: which door does this address use? */
  function chooseDoor() {
    if (!email.includes("@")) return;
    setRefusal(null);
    startTransition(async () => {
      const looked = await lookupSignInMethod(email);
      if (!looked.ok || !looked.method) {
        fail(looked.error, "Could not continue.");
        return;
      }

      if (looked.method === "federated") {
        // Told plainly. The person needs to know to go to their agency's login,
        // and how an institution arranges its identity is not a secret.
        setRefusal(
          "This organization signs in through its own identity provider. Use your agency's login rather than this page.",
        );
        return;
      }

      if (looked.method === "email_code") {
        const sent = await requestCode(email);
        if (!sent.ok) {
          setRefusal(sent.error ?? "Could not send a code.");
          return;
        }
        setStep({ name: "code" });
        toast.show("success", "If that address has an account, a code is on its way.");
        return;
      }

      setStep({ name: "password", method: looked.method });
    });
  }

  function signInWithPassword() {
    if (password.length === 0) return;
    startTransition(async () => {
      const result = await submitPassword(email, password);
      if (result?.secondFactor) {
        setStep({ name: "second-factor" });
        return;
      }
      if (result?.mustChange) {
        setPassword("");
        setStep({ name: "must-change" });
        return;
      }
      // Success redirects, so reaching here means it failed.
      if (result && !result.ok) fail(result.error, "That address and password do not match.");
    });
  }

  function askForReset() {
    startTransition(async () => {
      const result = await requestReset(email);
      if (!result.ok) {
        fail(result.error, "Could not send a reset code.");
        return;
      }
      setStep({ name: "reset-sent" });
      toast.show("success", "If that address has an account, a code is on its way.");
    });
  }

  function finishReset() {
    if (!code.trim() || !password) return;
    startTransition(async () => {
      const result = await submitReset(email, code, password);
      if (!result.ok) {
        fail(result.error, "That code is not valid.");
        return;
      }
      setCode("");
      setPassword("");
      setStep({ name: "address" });
      toast.show("success", "Password set. Sign in with it.");
    });
  }

  function verifyCode() {
    if (code.trim().length === 0) return;
    startTransition(async () => {
      const result = await submitCode(email, code);
      if (result?.secondFactor) {
        setStep({ name: "second-factor" });
        return;
      }
      if (result && !result.ok) fail(result.error, "That code is not valid.");
    });
  }

  function verifySecondFactor() {
    if (factor.trim().length === 0) return;
    startTransition(async () => {
      const result = await submitSecondFactor(factor);
      if (result && !result.ok) fail(result.error, "That code is not valid.");
    });
  }

  function chooseOwnPassword() {
    if (password.length === 0) return;
    startTransition(async () => {
      const result = await changeOwnPassword(password);
      if (result && !result.ok) fail(result.error, "Could not set that password.");
    });
  }

  const startOver = (
    <Button
      variant="ghost"
      onClick={() => {
        setStep({ name: "address" });
        setPassword("");
        setCode("");
        setRefusal(null);
      }}
      disabled={pending}
    >
      Use a different address
    </Button>
  );

  if (step.name === "second-factor") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          Open your authenticator and enter the six-digit code. This account
          reads every market, so it asks for a second factor.
        </p>
        <TextField
          label="Authenticator code"
          value={factor}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={14}
          onChange={(event) => setFactor(event.target.value)}
          hint="Or one of your recovery codes, if the phone is not to hand."
          onKeyDown={(event) => {
            if (event.key === "Enter") verifySecondFactor();
          }}
        />
        <Button
          variant="primary"
          onClick={verifySecondFactor}
          disabled={pending || !factor.trim()}
        >
          {pending ? "Checking…" : "Sign in"}
        </Button>
        <Note icon={<ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />}>
          Nothing is signed in until this step passes. A recovery code works here
          too, and works once.
        </Note>
      </div>
    );
  }

  if (step.name === "must-change") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          That password was set for you by an administrator. Choose your own
          before going any further — a temporary credential somebody else knows
          should not become a permanent one.
        </p>
        <TextField
          label="New password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
          hint="At least 12 characters. A long phrase beats a short one with symbols in it."
          onKeyDown={(event) => {
            if (event.key === "Enter") chooseOwnPassword();
          }}
        />
        <Button
          variant="primary"
          onClick={chooseOwnPassword}
          disabled={pending || !password}
        >
          {pending ? "Saving…" : "Set my password"}
        </Button>
      </div>
    );
  }

  if (step.name === "reset-sent") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          If that address has an account, a code is on its way. Enter it and
          choose your password — the same step whether you are replacing one or
          setting your first.
        </p>
        <TextField
          label="Reset code"
          value={code}
          autoComplete="one-time-code"
          maxLength={12}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          hint="Eight characters, good for ten minutes, usable once."
        />
        <TextField
          label="New password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
          hint="At least 12 characters."
          onKeyDown={(event) => {
            if (event.key === "Enter") finishReset();
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={finishReset}
            disabled={pending || !code.trim() || !password}
          >
            {pending ? "Saving…" : "Set new password"}
          </Button>
          {startOver}
        </div>
      </div>
    );
  }

  if (step.name === "code") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          This organization signs in with a one-time code rather than a password.
          Check the mailbox your agency issued you.
        </p>
        <TextField
          label="Code"
          value={code}
          autoComplete="one-time-code"
          maxLength={12}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          hint="Eight characters, good for ten minutes, usable once."
          onKeyDown={(event) => {
            if (event.key === "Enter") verifyCode();
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={verifyCode} disabled={pending || !code.trim()}>
            {pending ? "Checking…" : "Sign in"}
          </Button>
          {startOver}
        </div>
        <Note icon={<Mail className="w-4 h-4 shrink-0 mt-0.5" />}>
          No password is held here for this account. The code can only be sent to
          an address on your organization&rsquo;s own domain.
        </Note>
      </div>
    );
  }

  if (step.name === "password") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Signing in as <span className="font-semibold text-ink-950">{email}</span>
        </p>
        <TextField
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") signInWithPassword();
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={signInWithPassword}
            disabled={pending || !password}
          >
            {pending ? "Checking…" : "Sign in"}
          </Button>
          <Button variant="quiet" onClick={askForReset} disabled={pending}>
            Forgot your password?
          </Button>
          {startOver}
        </div>
        <Note icon={<Mail className="w-4 h-4 shrink-0 mt-0.5" />}>
          Never set one? Use the same link. Accounts here are created by an
          administrator or an import, so the first password is chosen the same
          way a forgotten one is replaced — with a code sent to this address.
        </Note>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Work email"
        type="email"
        value={email}
        autoComplete="email"
        onChange={(event) => setEmail(event.target.value)}
        hint="The address your organization knows you by."
        onKeyDown={(event) => {
          if (event.key === "Enter") chooseDoor();
        }}
      />

      {refusal && (
        <p className="text-sm text-crit-700 flex items-start gap-2">
          <KeyRound className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{refusal}</span>
        </p>
      )}

      <Button
        variant="primary"
        onClick={chooseDoor}
        disabled={pending || !email.includes("@")}
      >
        {pending ? "Checking…" : "Continue"}
      </Button>

      <Note icon={<Mail className="w-4 h-4 shrink-0 mt-0.5" />}>
        Your address decides what happens next. Most people are asked for a
        password; a public agency is sent a one-time code instead, because this
        platform holds no password for a government employee.
      </Note>
    </div>
  );
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="text-xs text-ink-500 flex items-start gap-2 pt-2">
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
