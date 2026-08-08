"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  GraduationCap,
  Landmark,
  Lock,
  School,
  SlidersHorizontal,
} from "lucide-react";
import type { ActorRole } from "@/domain/types";
import { demoAccounts } from "@/data/session";
import { Button, ChoiceGroup, Modal, ToastProvider } from "@/components/ui";

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

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [signOnOpen, setSignOnOpen] = useState(false);

  const active = PORTALS.find((p) => pathname.startsWith(p.href));

  return (
    <ToastProvider>
      <div className="min-h-screen bg-ink-50 text-ink-950 antialiased selection:bg-brand-200 flex flex-col">
        <DemoNotice />
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-brand-100">
          <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 group shrink-0">
              <span className="w-10 h-10 rounded-xl bg-brand-500 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-brand-500/30 group-hover:bg-ink-950 transition-colors">
                OE
              </span>
              <span className="hidden sm:block">
                <span className="text-lg font-extrabold tracking-tight text-ink-950">
                  Opportunity
                </span>
                <span className="text-lg font-extrabold text-brand-500 ml-1">
                  Ecosystem
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
                return (
                  <Link
                    key={portal.role}
                    href={portal.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      isActive
                        ? portal.role === "admin"
                          ? "bg-ink-950 text-white shadow-sm"
                          : "bg-brand-500 text-white shadow-sm"
                        : "text-ink-600 hover:text-ink-950"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    {portal.label}
                  </Link>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={() => setSignOnOpen(true)}
              className="bg-ink-950 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-brand-500 transition-colors flex items-center gap-2 shrink-0"
            >
              <Lock className="w-4 h-4 text-brand-400" aria-hidden="true" />
              Sign on
            </button>
          </div>

          {/* Small screens get the switcher as a scrolling row rather than losing it */}
          <div className="lg:hidden border-t border-ink-100 overflow-x-auto">
            <div className="flex gap-1 px-4 py-2 min-w-max">
              {PORTALS.map((portal) => {
                const isActive = active?.role === portal.role;
                return (
                  <Link
                    key={portal.role}
                    href={portal.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                      isActive ? "bg-brand-500 text-white" : "text-ink-600"
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
          Opportunity Ecosystem — demonstration prototype
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
  const router = useRouter();
  const [selected, setSelected] = useState<ActorRole>("admin");

  function enterPortal() {
    onClose();
    router.push(`/${selected}`);
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
          <Button variant="dark" onClick={enterPortal}>
            Enter portal
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
