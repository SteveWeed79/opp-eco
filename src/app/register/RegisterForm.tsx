"use client";

import { useState, useTransition } from "react";
import { GraduationCap } from "lucide-react";
import { Button, SelectField, TextField, useToast } from "@/components/ui";
import type { RegistrableCollege } from "@/domain/registration";
import { register } from "./actions";

/**
 * The form a learner fills in to exist.
 *
 * **The success message is deliberately the same whether or not the address was
 * already registered**, because this page is reachable by anybody and the
 * alternative is an oracle for which addresses hold accounts. The service does
 * the same on its side; this is the half a person sees, and the two have to
 * agree or the difference in wording gives the game away.
 *
 * It also says what happens next, at the point where somebody is about to stop
 * paying attention: no password arrives, because no account here is issued one
 * — you ask for it on the sign-in page — and the college still has to verify
 * you before you can apply for anything.
 */
export function RegisterForm({ colleges }: { colleges: RegistrableCollege[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeId, setCollegeId] = useState(colleges[0]?.id ?? "");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function submit() {
    startTransition(async () => {
      const form = new FormData();
      form.set("name", name);
      form.set("email", email);
      form.set("collegeId", collegeId);
      const result = await register(form);
      if (result.ok) setDone(true);
      else toast.show("error", result.error ?? "Could not register you.");
    });
  }

  if (done) {
    return (
      <div className="px-6 py-8 text-center">
        <GraduationCap className="w-8 h-8 mx-auto text-brand-700 mb-3" aria-hidden="true" />
        <p className="text-base font-bold text-ink-950">Check your email</p>
        <p className="mt-2 text-sm text-ink-600 max-w-prose mx-auto">
          We have sent the next step to <strong>{email}</strong>. There is no
          password in it — nobody here is issued one. You choose yours on the
          sign-in page with <em>Forgot your password?</em>, and your college
          confirms you are their learner before you can apply for anything.
        </p>
      </div>
    );
  }

  const chosen = colleges.find((c) => c.id === collegeId);

  return (
    <div className="px-6 py-6 space-y-4">
      <TextField
        label="Your name"
        value={name}
        required
        onChange={(event) => setName(event.target.value)}
        autoComplete="name"
      />

      <SelectField
        label="Where you study"
        value={collegeId}
        required
        onChange={(event) => setCollegeId(event.target.value)}
        options={colleges.map((college) => ({
          value: college.id,
          label: `${college.name} · ${college.marketName}`,
        }))}
      />

      <TextField
        label="Your college email address"
        value={email}
        required
        type="email"
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        hint={
          chosen
            ? `It has to be a ${chosen.name} address — that is how we know you are their learner.`
            : undefined
        }
      />

      <Button
        variant="primary"
        onClick={submit}
        disabled={!name.trim() || !email.trim() || !collegeId || pending}
      >
        {pending ? "Registering…" : "Register"}
      </Button>
    </div>
  );
}
