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
  level = 2,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /**
   * Heading level. Cards sitting inside a `PageSection` are subordinate to its
   * heading, so they take 3 — a page whose outline says h1 › h2 › h2 tells a
   * screen-reader user the zone and the card are peers when they are not.
   */
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-ink-100">
      <div className="flex items-start gap-3">
        {icon && <span className="text-brand-700 mt-0.5">{icon}</span>}
        <div>
          <Heading className="text-base font-bold text-ink-950 text-balance">
            {title}
          </Heading>
          {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * A named zone within a portal.
 *
 * Every portal was one flat stack of Cards, which meant reading order carried
 * no rank. A queue blocking a placement, a reference table, and a settings
 * panel touched once a year all rendered identically — same white, same
 * radius, same border, same header. Two things follow from that, and both were
 * live: anything appended to the end became invisible, and configuration read
 * exactly like work.
 *
 * So a portal is now two to four named zones rather than five to seven
 * anonymous cards, and the name says what the zone is *for* — "needs you
 * today" is a promise about what is inside it.
 *
 * `tone` is the part that does the work. `work` is what the portal exists for;
 * `settings` is deliberately recessed, because a page that gives equal weight
 * to "four students are waiting on you" and "pick a brand colour" has not
 * decided what it is for.
 */
export function PageSection({
  title,
  description,
  action,
  tone = "work",
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "work" | "settings";
  children: ReactNode;
}) {
  const settings = tone === "settings";

  return (
    <section
      className={
        settings
          ? "border-t border-ink-200 pt-8 mt-4"
          : ""
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2
            className={
              settings
                ? "text-xs font-bold text-ink-500 uppercase tracking-widest"
                : "text-lg font-black text-ink-950"
            }
          >
            {title}
          </h2>
          {description && (
            <p className="text-sm text-ink-500 mt-1 max-w-2xl">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
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
            dark ? "text-brand-400" : "text-brand-700"
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
    brand: "text-brand-700",
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
      "bg-brand-700 text-white hover:bg-ink-950 shadow-sm shadow-brand-700/25",
    dark: "bg-ink-950 text-white hover:bg-brand-700 shadow-sm",
    ghost: "bg-white text-ink-950 border border-ink-200 hover:bg-ink-50",
    quiet: "bg-transparent text-brand-700 hover:text-ink-950 hover:underline",
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
      // `whitespace-nowrap` because a button is a target, not a paragraph.
      // In the narrow action column of a table "End placement early" broke
      // across three lines and read as a rendering fault; where two buttons
      // genuinely do not fit, the flex row wraps them onto separate lines
      // instead, which is legible.
      className={`whitespace-nowrap rounded-xl font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]}`}
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
  label,
}: {
  value: number;
  max: number;
  tone?: "brand" | "good" | "warn" | "crit";
  /**
   * Required by `role="progressbar"`. Without it a screen reader announces
   * "progress bar, 33" with no indication of what is at 33 or out of what.
   */
  label: string;
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
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={`${value} of ${max}`}
    >
      <div className={`h-full rounded-full ${fills[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
