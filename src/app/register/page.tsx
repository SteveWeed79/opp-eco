import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Card, CardHeader, Empty, PageHeader } from "@/components/ui";
import { registrableColleges } from "@/services/registration";
import { SIGN_IN_PATH } from "@/routes";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = {
  title: "Register",
  robots: { index: false, follow: false },
};

/**
 * The door Phase 1 of the user story has always described and never had.
 *
 * "Students self-activate once their market is live" — and until now every
 * account in this system existed because the seed made it or an administrator
 * added one by hand, which left the college holding a verification queue
 * nothing could fill.
 *
 * **The demonstration's markets are excluded**, so on a deployment with no live
 * real market this page has an empty list and says so. That is the honest
 * outcome rather than a missing feature: registration writes a real person's
 * name and address, and writing those into rows flagged `is_demo_data` — rows
 * the next `db:seed` deletes — is the one thing this whole branch exists to
 * prevent. The demonstration shows the form; it does not take registrations.
 *
 * Public, and `noindex` for the same reason the sign-in page is: a form that
 * creates accounts does not want search traffic.
 */
export default async function RegisterPage() {
  const colleges = await registrableColleges();

  return (
    <div className="max-w-2xl mx-auto px-6 pt-10 pb-16">
      <PageHeader
        eyebrow="Learners"
        title="Register"
        subtitle="Paid work near you, for academic credit. Your college confirms you are their learner, and then you can apply."
      />

      <Card>
        <CardHeader
          icon={<GraduationCap className="w-5 h-5" />}
          title="Create your account"
          subtitle="You will choose a password afterwards, on the sign-in page"
        />
        {colleges.length === 0 ? (
          <Empty>
            No market is open for registration yet. A market opens once its
            workforce board and college have both committed — if yours is close,
            your college will tell you.
          </Empty>
        ) : (
          <RegisterForm colleges={colleges} />
        )}
      </Card>

      <p className="mt-6 text-sm text-ink-600">
        Already registered?{" "}
        <Link className="font-semibold text-brand-700 underline" href={SIGN_IN_PATH}>
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
