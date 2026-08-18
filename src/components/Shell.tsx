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
  readOnly = false,
}: {
  children: React.ReactNode;
  signedInAs?: string;
  /** Absent when signed out, which is when every portal is browsable. */
  signedInRole?: ActorRole;
  /** Resolved server-side; applied here, because only here knows the route. */
  theme: ResolvedTheme;
  /** True when the deployment is backed by a database nothing may write to. */
  readOnly?: boolean;
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
        className="min-h-screen text-ink-950 antialiased selection:bg-brand-200 flex flex-col"
      >
        <DemoNotice readOnly={readOnly} />
        {/* A shadow rather than only a hairline: the header has to read as
            floating above the page it is pinned over, or a card scrolling
            under it looks like it is passing through it. */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-line shadow-[0_1px_3px_rgb(15_23_42/0.04),0_8px_24px_-12px_rgb(15_23_42/0.12)]">
          <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 group shrink-0">
              <span
                className={`w-10 h-10 rounded-card bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center font-bold shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_2px_6px_-1px_rgb(3_105_161/0.5)] group-hover:from-ink-700 group-hover:to-ink-950 transition-all overflow-hidden ${markTextSize(
                  themed ? theme.monogram : brand.monogram,
                )}`}
                style={
                  themed && theme.hasAccent
                    ? { boxShadow: "0 0 0 2px var(--color-accent)" }
                    : undefined
                }
              >
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
              {/* Stacked rather than inline. On one line the full name ran the
                  header to 1390px against 1280 of viewport — measured, not
                  guessed — and it is the themed pages that overflow first,
                  because those also carry the "Themed for" attribution. Two
                  lines keeps the whole name next to the mark instead of
                  trading it for an acronym. */}
              <span className="hidden sm:block leading-tight">
                <span className="block text-sm font-extrabold tracking-tight text-ink-950">
                  {brand.lead}
                </span>
                <span className="block text-sm font-extrabold text-brand-700">
                  {brand.accent}
                </span>
              </span>
            </Link>

            <nav
              aria-label="Demo portal switcher"
              // A recessed track with a raised pill riding in it, rather than
              // a flat grey bar — the segmented control is the one place a
              // sunken surface genuinely helps, because it explains why the
              // active item looks like it is sitting on top.
              className="hidden lg:flex items-center gap-1 bg-canvas-deep p-1 rounded-full border border-line shadow-inset"
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
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      isActive
                        ? portal.role === "admin"
                          ? "bg-gradient-to-b from-ink-700 to-ink-950 text-white shadow-[0_1px_0_rgb(255_255_255/0.14)_inset,0_1px_3px_rgb(15_23_42/0.3)]"
                          : "bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_1px_3px_rgb(3_105_161/0.4)]"
                        : "text-ink-600 hover:text-ink-950 hover:bg-white/70"
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
                    className="bg-surface border border-line-strong text-ink-700 px-4 py-2.5 rounded-card font-semibold text-sm shadow-e1 hover:bg-canvas hover:border-ink-400 active:translate-y-px transition-all flex items-center gap-2"
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
                className="bg-gradient-to-b from-ink-700 to-ink-950 text-white px-4 py-2.5 rounded-card font-semibold text-sm shadow-[0_1px_0_rgb(255_255_255/0.14)_inset,0_2px_6px_-1px_rgb(2_6_23/0.4)] hover:from-brand-600 hover:to-brand-700 active:translate-y-px transition-all flex items-center gap-2 shrink-0"
              >
                <Lock className="w-4 h-4 text-brand-400" aria-hidden="true" />
                Sign on
              </button>
            )}
          </div>

          {/* The school's second colour, as a band.
              Deliberately the only place it appears at full strength: an
              accent is what a crimson-and-gold institution recognises as
              theirs, and it does its job without carrying any text. */}
          {themed && theme.hasAccent && (
            <div
              aria-hidden="true"
              className="h-1 w-full"
              style={{ backgroundColor: "var(--color-accent)" }}
            />
          )}

          {/* Small screens get the switcher as a scrolling row rather than losing it */}
          <div className="lg:hidden border-t border-line overflow-x-auto">
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

        {/* Bottom padding belongs to each page, not to the frame. A blanket
            `pb-20` here left a dead band of canvas under the landing page,
            whose last section is a full-bleed white one and needs to meet the
            footer directly. */}
        <main className="flex-1">{children}</main>

        <DemoFooter />

        {signOnOpen && <SignOnDialog onClose={() => setSignOnOpen(false)} />}
      </div>
    </ToastProvider>
  );
}

/**
 * Type size for the square mark, chosen by how much is in it.
 *
 * Partner monograms are two letters; the platform's is four, because the
 * programme goes by its initialism rather than a shortening of its words. One
 * fixed size cannot serve both — "CCLN" at the two-letter size spills out of a
 * 40px box, and shrinking every mark to fit it would make a partner's initials
 * look apologetic next to their own colours.
 */
function markTextSize(monogram: string): string {
  if (monogram.length >= 4) return "text-[11px] tracking-tight";
  if (monogram.length === 3) return "text-sm";
  return "text-lg";
}

/**
 * Persistent on every page, deliberately not dismissible.
 *
 * An interstitial on `/` would guard the one page most viewers never see —
 * every portal is directly linkable and the switcher jumps between them. The
 * notice has to travel with the pages themselves, including when a link to
 * `/admin` is forwarded to someone with no context for what they're looking at.
 */
function DemoNotice({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="bg-ink-950 text-white">
      <p className="max-w-7xl mx-auto px-6 py-2 text-xs sm:text-sm flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-400/15 px-2.5 py-0.5 font-bold uppercase tracking-widest text-brand-400 ring-1 ring-inset ring-brand-400/25">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-brand-400"
          />
          Demonstration
        </span>
        <span className="text-ink-400">
          Concept prototype. Every organization, student, and figure shown is
          fictional — this is not a live program and nothing here can be applied
          for.
        </span>
        {readOnly && (
          /* Only shown when it is true. A permanent "read only" label on the
             writable demo would be a lie, and one that trains people to ignore
             the banner. */
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 font-semibold text-ink-200 ring-1 ring-inset ring-white/15">
            <Lock className="w-3 h-3" aria-hidden="true" />
            Read-only — browsing seeded data
          </span>
        )}
      </p>
    </div>
  );
}

function DemoFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="max-w-7xl mx-auto px-6 py-10 text-sm text-ink-500 space-y-2.5">
        <p className="font-bold text-ink-950 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-4 w-1 rounded-full bg-brand-600"
          />
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
