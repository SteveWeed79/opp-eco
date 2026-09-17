import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { ShieldCheck } from "lucide-react";
import { authConfig } from "@/auth/config";
import { getActor } from "@/auth/session";
import { DEMO_ROOT, PORTAL_PATH } from "@/routes";
import Link from "next/link";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * The way in.
 *
 * Its own route at the site root, and `Shell` gives it neither the venture
 * header nor the demo chrome — see `isSignOnSurface`. It sat at
 * `/demo/sign-in` until somebody actually looked at it, wearing a banner
 * reading "every organization, student and figure shown is fictional" above a
 * nav bar offering one-click entry to all five portals. That is not a login
 * page; it is a demonstration with a password field in it.
 *
 * **The route always resolves**, whichever sign-on the deployment runs. A URL
 * that 404s or bounces depending on an environment variable is one nobody can
 * safely put in writing, and this one goes in emails. What changes is what it
 * offers: under real sign-on, the form; under the demonstration's role picker,
 * a plain statement that this deployment has no accounts, rather than a form
 * that would mint a session nothing reads.
 */
export default async function SignInPage() {
  const demonstration = authConfig().mode !== "code";

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

  if (demonstration) {
    return (
      <div className="max-w-md mx-auto px-6 pt-16 pb-20 space-y-6">
        <PageHeader
          eyebrow="Sign in"
          title="There is nothing to sign in to"
          subtitle="This deployment is running the demonstration, which has no accounts and no credentials — anyone can look at any portal."
        />
        <Card>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-ink-700 leading-relaxed">
              Said plainly rather than hidden, because a sign-in page that
              redirects somewhere else is indistinguishable from a broken one.
              A deployment holding real records runs real sign-on and this page
              asks for a credential.
            </p>
            <Link
              href={DEMO_ROOT}
              className="inline-flex items-center gap-2 bg-gradient-to-b from-ink-700 to-ink-950 text-white px-4 py-2.5 rounded-card font-semibold text-sm"
            >
              Open the demonstration
            </Link>
          </div>
        </Card>
      </div>
    );
  }

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
