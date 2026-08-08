/**
 * Shared presentation primitives.
 *
 * State is encoded in form as well as number — a pill, a stripe, a dwell
 * badge — so what needs attention reads at a glance rather than requiring the
 * viewer to compare figures.
 */

import type { ReactNode } from "react";
import type { ApplicationStatus, Posting, Track } from "@/domain/types";
import { creditsFor } from "@/domain/credit";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-brand-100 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-ink-100">
      <div className="flex items-start gap-3">
        {icon && <span className="text-brand-500 mt-0.5">{icon}</span>}
        <div>
          <h2 className="text-base font-bold text-ink-950 text-balance">{title}</h2>
          {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl px-8 py-7 flex flex-wrap items-center justify-between gap-4 ${
        dark
          ? "bg-ink-950 text-white shadow-lg"
          : "bg-white border border-brand-100 shadow-sm"
      }`}
    >
      <div>
        <span
          className={`text-xs font-bold uppercase tracking-widest ${
            dark ? "text-brand-400" : "text-brand-600"
          }`}
        >
          {eyebrow}
        </span>
        <h1
          className={`text-2xl sm:text-3xl font-black mt-1 text-balance ${
            dark ? "text-white" : "text-ink-950"
          }`}
        >
          {title}
        </h1>
        {subtitle && (
          <p className={`text-sm mt-1.5 ${dark ? "text-ink-400" : "text-ink-500"}`}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tiles
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "crit" | "brand";
}) {
  const valueTone = {
    neutral: "text-ink-950",
    good: "text-good-700",
    warn: "text-warn-700",
    crit: "text-crit-700",
    brand: "text-brand-600",
  }[tone];

  return (
    <Card className="p-5">
      <p className="text-xs font-bold text-ink-500 uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-black mt-2 tabular ${valueTone}`}>{value}</p>
      {hint && <p className="text-xs text-ink-500 mt-1.5">{hint}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

type BadgeTone = "neutral" | "brand" | "good" | "warn" | "crit" | "micro";

export function Badge({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-ink-100 text-ink-700 border-ink-200",
    brand: "bg-brand-50 text-brand-700 border-brand-200",
    good: "bg-good-50 text-good-700 border-good-100",
    warn: "bg-warn-50 text-warn-700 border-warn-100",
    crit: "bg-crit-50 text-crit-700 border-crit-100",
    micro: "bg-micro-50 text-micro-700 border-micro-100",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Shows the track, and credit only where the posting actually carries it.
 *
 * Hardcoding "Micro · 1 cr" badged a 15-hour project as worth a credit it
 * cannot earn on its own — contradicting the credit rules and the app's own
 * explanation of stacking. Pass the posting so the badge tells the truth.
 */
export function TrackBadge({
  track,
  posting,
  hoursPerCredit,
}: {
  track: Track;
  posting?: Posting;
  hoursPerCredit?: number;
}) {
  const credits = posting ? creditsFor(posting, hoursPerCredit) : null;
  const label =
    credits === null
      ? track === "micro"
        ? "Micro"
        : "Standard"
      : credits > 0
        ? `${track === "micro" ? "Micro" : "Standard"} · ${credits} cr`
        : `${track === "micro" ? "Micro" : "Standard"} · banks hours`;

  return <Badge tone={track === "micro" ? "micro" : "brand"}>{label}</Badge>;
}

/** Human label and severity for every state in the machine. */
export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: BadgeTone }
> = {
  submitted: { label: "Submitted", tone: "neutral" },
  under_review: { label: "Under review", tone: "neutral" },
  shortlisted: { label: "Shortlisted", tone: "brand" },
  mutual_interest: { label: "Mutual interest", tone: "warn" },
  interview_scheduled: { label: "Interview booked", tone: "warn" },
  interview_completed: { label: "Awaiting determination", tone: "warn" },
  cleared: { label: "Eligible — awaiting funding", tone: "warn" },
  funding_authorized: { label: "Funding authorized", tone: "good" },
  unsubsidized: { label: "Unsubsidized", tone: "neutral" },
  placement_active: { label: "Placement active", tone: "good" },
  placement_completed: { label: "Work complete", tone: "good" },
  credit_pending: { label: "Credit pending", tone: "warn" },
  credit_granted: { label: "Credit granted", tone: "good" },
  credit_denied: { label: "Credit denied", tone: "crit" },
  rejected: { label: "Declined", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  terminated_early: { label: "Ended early", tone: "crit" },
  closed: { label: "Closed", tone: "neutral" },
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const meta = STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * Dwell time carries severity in its form, because a number alone doesn't
 * signal that 19 days in the pause is a placement about to die.
 */
export function DwellBadge({ days, threshold = 7 }: { days: number; threshold?: number }) {
  const tone: BadgeTone =
    days >= threshold * 2 ? "crit" : days >= threshold ? "warn" : "neutral";
  return (
    <Badge tone={tone}>
      {days} {days === 1 ? "day" : "days"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  type = "button",
  disabled,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "dark" | "ghost" | "quiet" | "danger";
  size?: "sm" | "md";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  const variants = {
    primary:
      "bg-brand-500 text-white hover:bg-ink-950 shadow-sm shadow-brand-500/25",
    dark: "bg-ink-950 text-white hover:bg-brand-500 shadow-sm",
    ghost: "bg-white text-ink-950 border border-ink-200 hover:bg-ink-50",
    quiet: "bg-transparent text-brand-600 hover:text-ink-950 hover:underline",
    // Reserved for irreversible actions, so the colour keeps its meaning.
    danger: "bg-crit-600 text-white hover:bg-crit-700 shadow-sm",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-5 py-2.5 text-sm",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-xl font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="py-3 px-4 text-left text-xs font-extrabold text-ink-600 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`py-3.5 px-4 text-sm text-ink-700 ${className}`}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Empty states and notes
// ---------------------------------------------------------------------------

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center text-sm text-ink-500">{children}</div>
  );
}

/**
 * A visible marker for a design decision standing in for an unanswered
 * question. Cheap to find, cheap to reverse.
 */
export function Assumption({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-ink-500 border-l-2 border-warn-600 pl-3 py-1">
      <span className="font-bold text-warn-700 uppercase tracking-wider">
        Assumption
      </span>{" "}
      {children}
    </p>
  );
}

export function Money({ value }: { value: number }) {
  return <span className="tabular">${value.toLocaleString("en-US")}</span>;
}

export function ProgressBar({
  value,
  max,
  tone = "brand",
}: {
  value: number;
  max: number;
  tone?: "brand" | "good" | "warn" | "crit";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fills = {
    brand: "bg-brand-500",
    good: "bg-good-600",
    warn: "bg-warn-600",
    crit: "bg-crit-600",
  };
  return (
    <div
      className="h-2 w-full rounded-full bg-ink-100 overflow-hidden"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={`h-full rounded-full ${fills[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
