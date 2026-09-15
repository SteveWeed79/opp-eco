import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { ShieldCheck } from "lucide-react";
import { authConfig } from "@/auth/config";
import { getActor } from "@/auth/session";
import { DEMO_ROOT, PORTAL_PATH } from "@/routes";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * The sign-in page, which only exists under real sign-on.
 *
 * In demo mode it redirects to the prototype index rather than rendering, so
 * the role picker stays the single way in and there is never a second door
 * offering a flow the deployment does not run.
 */
export default async function SignInPage() {
  if (authConfig().mode !== "code") redirect(DEMO_ROOT);

  // Already signed in: go where you belong rather than offering to sign in again.
  const actor = await getActor();
  if (actor) redirect(PORTAL_PATH[actor.membership.role]);

  return (
    <div className="max-w-md mx-auto px-6 pt-10 pb-16 space-y-6">
      <PageHeader
        eyebrow="Sign in"
        title="Sign in"
        subtitle="Start with the address your organization knows you by. It decides what you are asked for next."
      />

      <Card>
        <CardHeader
          level={2}
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Your work address"
          subtitle="Organizations that run their own identity provider sign in there instead"
        />
        <div className="px-6 py-5">
          <SignInForm />
        </div>
      </Card>
    </div>
  );
}
