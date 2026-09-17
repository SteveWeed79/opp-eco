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
  //
  // With one exception, and it is the whole reason `mustChange` is not merely
  // decorative. A session that owes a password change is sent *here* by every
  // portal gate, so redirecting it back would be a loop — and the form it needs
  // is the one on this page. The obligation is read from the session rather than
  // from client state, because the person who typed a portal URL instead of
  // following the form has to land on it too.
  const actor = await getActor();
  const owed = actor?.passwordChangeOwed === true;
  if (actor && !owed) redirect(PORTAL_PATH[actor.membership.role]);

  return (
    <div className="max-w-md mx-auto px-6 pt-10 pb-16 space-y-6">
      <PageHeader
        eyebrow="Sign in"
        title={owed ? "Choose your password" : "Sign in"}
        subtitle={
          owed
            ? "You are signed in, and this is the only thing this session can do until you have one of your own."
            : "Start with the address your organization knows you by. It decides what you are asked for next."
        }
      />

      <Card>
        <CardHeader
          level={2}
          icon={<ShieldCheck className="w-5 h-5" />}
          title={owed ? "A password of your own" : "Your work address"}
          subtitle={
            owed
              ? "The one you were given was set by somebody else and is spent"
              : "Organizations that run their own identity provider sign in there instead"
          }
        />
        <div className="px-6 py-5">
          <SignInForm mustChange={owed} />
        </div>
      </Card>
    </div>
  );
}
