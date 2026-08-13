"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  GraduationCap,
  Landmark,
  Lock,
  LogOut,
  School,
  SlidersHorizontal,
} from "lucide-react";
import type { ActorRole } from "@/domain/types";
import { demoAccounts } from "@/data/session";
import { Button, ChoiceGroup, Modal, ToastProvider } from "@/components/ui";
import { signInAs, signOut } from "@/auth/actions";
import { brand } from "@/brand";
import { isPartnerSurface } from "@/theme/theme";
import type { ResolvedTheme } from "@/theme/resolve";

const PORTALS: {
  role: ActorRole;
  href: string;
  label: string;
  icon: typeof Building2;
}[] = [
  { role: "admin", href: "/admin", label: "Admin", icon: SlidersHorizontal },
  { role: "student", href: "/student", label: "Student", icon: GraduationCap },
  { role: "business", href: "/business", label: "Business", icon: Building2 },
  { role: "college", href: "/college", label: "College", icon: School },
  { role: "board", href: "/board", label: "Workforce Board", icon: Landmark },
];

export function Shell({
  children,
  signedInAs,
  signedInRole,
  theme,
}: {
  children: React.ReactNode;
  signedInAs?: string;
  /** Absent when signed out, which is when every portal is browsable. */
  signedInRole?: ActorRole;
  /** Resolved server-side; applied here, because only here knows the route. */
  theme: ResolvedTheme;
}) {
  const pathname = usePathname();
  const [signOnOpen, setSignOnOpen] = useState(false);

  const active = PORTALS.find((p) => pathname.startsWith(p.href));

  /**
   * Which portals this session can open.
   *
   * Signed out, all of them — the switcher is how a demonstration gets walked
   * through, and every screen has to be reachable from a bare link.
   *
   * Signed in, only your own. An administrator signing in used to be handed
   * any portal they clicked, which crashed all four of the others: every
   * portal reads an organization and a market off the membership, and an
   * administrator holds neither. Beyond the crash, an administrator inhabiting
   * a student's portal is not oversight — the admin console is the read path
   * built for that, and it is the one that redacts.
   */
  const reachable = (portal: ActorRole) => !signedInRole || signedInRole === portal;

  /**
   * A partner's colours apply to the student and college portals only.
   *
   * The administrator and the workforce board are looking at the platform
   * working across many partners; painting the board's console in one
   * college's colours would misrepresent what they are seeing.
   */
  const themed = theme.isPartner && isPartnerSurface(pathname);

  return (
    <ToastProvider>
      <div
        style={themed ? (theme.variables as React.CSSProperties) : undefined}
        className="min-h-screen bg-ink-50 text-ink-950 antialiased selection:bg-brand-200 flex flex-col"
      >
        <DemoNotice />
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-brand-100">
          <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 group shrink-0">
              <span className="w-10 h-10 rounded-xl bg-brand-700 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-brand-700/30 group-hover:bg-ink-950 transition-colors overflow-hidden">
                {themed && theme.logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={theme.logoUrl}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                ) : (
                  (themed ? theme.monogram : brand.monogram)
                )}
              </span>
              <span className="hidden sm:block">
                <span className="text-lg font-extrabold tracking-tight text-ink-950">
                  {brand.lead}
                </span>
                <span className="text-lg font-extrabold text-brand-700 ml-1">
                  {brand.accent}
                </span>
              </span>
            </Link>

            <nav
              aria-label="Demo portal switcher"
              className="hidden lg:flex items-center gap-1 bg-ink-100 p-1 rounded-full border border-ink-200"
            >
              {PORTALS.map((portal) => {
                const Icon = portal.icon;
                const isActive = active?.role === portal.role;
                const open = reachable(portal.role);

                // Rendered as a disabled button rather than a dimmed link, so
                // it is genuinely unclickable and announces itself as
                // unavailable instead of looking like a link that does nothing.
                if (!open) {
                  return (
                    <button
                      key={portal.role}
                      type="button"
                      disabled
                      title={`Sign out to view the ${portal.label} portal. You are signed in as ${signedInAs}.`}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-ink-400 cursor-not-allowed"
                    >
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                      {portal.label}
                    </button>
                  );
                }

                return (
                  <Link
                    key={portal.role}
                    href={portal.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      isActive
                        ? portal.role === "admin"
                          ? "bg-ink-950 text-white shadow-sm"
                          : "bg-brand-700 text-white shadow-sm"
                        : "text-ink-600 hover:text-ink-950"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    {portal.label}
                  </Link>
                );
              })}
            </nav>

            {themed && (
              /* Says whose colours these are. A themed page that does not
                 attribute is a page pretending to be the school's own
                 system, which is a different and worse claim than
                 "your school, on this platform". */
              <span className="hidden xl:block text-xs text-ink-500 shrink-0">
                Themed for{" "}
                <span className="font-semibold text-ink-700">
                  {theme.organizationName}
                </span>
              </span>
            )}

            {signedInAs ? (
              <div className="flex items-center gap-3 shrink-0">
                <span className="hidden sm:block text-xs text-ink-500">
                  Signed in as{" "}
                  <span className="font-bold text-ink-950">{signedInAs}</span>
                </span>
                {/* A plain form post, so signing out works without JavaScript
                    and cannot be triggered by a cross-site GET. */}
                <form action={signOut}>
                  <button
                    type="submit"
                    className="border border-ink-200 text-ink-700 px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-ink-50 transition-colors flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSignOnOpen(true)}
                className="bg-ink-950 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors flex items-center gap-2 shrink-0"
              >
                <Lock className="w-4 h-4 text-brand-400" aria-hidden="true" />
                Sign on
              </button>
            )}
          </div>

          {/* Small screens get the switcher as a scrolling row rather than losing it */}
          <div className="lg:hidden border-t border-ink-100 overflow-x-auto">
            <div className="flex gap-1 px-4 py-2 min-w-max">
              {PORTALS.map((portal) => {
                const isActive = active?.role === portal.role;
                if (!reachable(portal.role)) {
                  return (
                    <button
                      key={portal.role}
                      type="button"
                      disabled
                      title={`Sign out to view the ${portal.label} portal.`}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap text-ink-400 cursor-not-allowed"
                    >
                      {portal.label}
                    </button>
                  );
                }
                return (
                  <Link
                    key={portal.role}
                    href={portal.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                      isActive ? "bg-brand-700 text-white" : "text-ink-600"
                    }`}
                  >
                    {portal.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </header>

        <main className="pb-20 flex-1">{children}</main>

        <DemoFooter />

        {signOnOpen && <SignOnDialog onClose={() => setSignOnOpen(false)} />}
      </div>
    </ToastProvider>
  );
}

/**
 * Persistent on every page, deliberately not dismissible.
 *
 * An interstitial on `/` would guard the one page most viewers never see —
 * every portal is directly linkable and the switcher jumps between them. The
 * notice has to travel with the pages themselves, including when a link to
 * `/admin` is forwarded to someone with no context for what they're looking at.
 */
function DemoNotice() {
  return (
    <div className="bg-ink-950 text-white">
      <p className="max-w-7xl mx-auto px-6 py-2 text-xs sm:text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold uppercase tracking-widest text-brand-400">
          Demonstration
        </span>
        <span className="text-ink-400">
          Concept prototype. Every organization, student, and figure shown is
          fictional — this is not a live program and nothing here can be applied
          for.
        </span>
      </p>
    </div>
  );
}

function DemoFooter() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="max-w-7xl mx-auto px-6 py-8 text-sm text-ink-500 space-y-2">
        <p className="font-bold text-ink-950">
          {brand.name} — demonstration prototype
        </p>
        <p className="max-w-3xl">
          Built to illustrate a proposed workforce-development program. The
          colleges, workforce boards, employers, students, placements, and
          dollar figures are invented for this demonstration. Kansas city and
          county names are real; no institution or organization named here has
          reviewed, endorsed, or agreed to participate.
        </p>
        <p className="max-w-3xl">
          Nothing on this site is an offer of employment, funding, academic
          credit, or wage reimbursement.
        </p>
      </div>
    </footer>
  );
}

/**
 * Sign-on picks a seeded account rather than checking a credential. The
 * session it produces is the real shape, so only this dialog changes when real
 * authentication arrives.
 */
function SignOnDialog({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<ActorRole>("admin");
  const [pending, startTransition] = useTransition();

  // The server establishes the session and redirects. Navigating on the client
  // would leave the role as client state, which is the mistake the original
  // mockup made by letting a dropdown choose the portal.
  function enterPortal() {
    startTransition(async () => {
      await signInAs(selected);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Choose a demo account"
      description="Sign-on is simulated. Every account below is seeded with real data."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="dark" onClick={enterPortal} disabled={pending}>
            {pending ? "Signing in…" : "Enter portal"}
          </Button>
        </>
      }
    >
      <ChoiceGroup
        label="Stakeholder"
        value={selected}
        onChange={setSelected}
        options={demoAccounts.map((account) => ({
          value: account.role,
          label: account.label,
          meta: account.organizationName,
          description: account.description,
        }))}
      />
    </Modal>
  );
}
