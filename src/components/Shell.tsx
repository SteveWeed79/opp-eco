"use client";

import { useEffect, useRef, useState } from "react";
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

const PORTALS: { role: ActorRole; href: string; label: string; icon: typeof Building2 }[] = [
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
    <div className="min-h-screen bg-ink-50 text-ink-950 antialiased selection:bg-brand-200">
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
              <span className="text-lg font-extrabold text-brand-500 ml-1">Ecosystem</span>
              <span className="block text-[10px] tracking-widest text-ink-500 font-semibold uppercase">
                Kansas Workforce Initiative
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

      <main className="pb-20">{children}</main>

      {signOnOpen && <SignOnDialog onClose={() => setSignOnOpen(false)} />}
    </div>
  );
}

/**
 * Sign-on picks a seeded account rather than checking a credential. The
 * session it produces is the real shape, so only this dialog changes when real
 * authentication arrives.
 */
function SignOnDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ActorRole>("admin");

  // Escape closes, focus is trapped, and focus returns where it came from.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>("button, [href], input")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  function enterPortal() {
    onClose();
    router.push(`/${selected}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signon-title"
        className="bg-white rounded-3xl max-w-lg w-full p-7 shadow-2xl border border-brand-100 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-5">
          <span className="w-11 h-11 bg-brand-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Lock className="w-5 h-5" aria-hidden="true" />
          </span>
          <h2 id="signon-title" className="text-xl font-black text-ink-950">
            Choose a demo account
          </h2>
          <p className="text-sm text-ink-500 mt-1">
            Sign-on is simulated. Every account below is seeded with real data.
          </p>
        </div>

        <div className="space-y-2 mb-5">
          {demoAccounts.map((account) => {
            const isSelected = selected === account.role;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => setSelected(account.role)}
                aria-pressed={isSelected}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                  isSelected
                    ? "border-brand-500 bg-brand-50"
                    : "border-ink-200 hover:bg-ink-50"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold text-sm text-ink-950">{account.label}</span>
                  <span className="text-xs text-ink-500">{account.organizationName}</span>
                </div>
                <p className="text-xs text-ink-500 mt-1">{account.description}</p>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl font-bold text-sm border border-ink-200 text-ink-700 hover:bg-ink-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={enterPortal}
            className="flex-1 py-3 bg-ink-950 text-white rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors"
          >
            Enter portal
          </button>
        </div>
      </div>
    </div>
  );
}
