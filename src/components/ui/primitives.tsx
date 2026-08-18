/**
 * Shared presentation primitives.
 *
 * State is encoded in form as well as number — a pill, a stripe, a dwell
 * badge — so what needs attention reads at a glance rather than requiring the
 * viewer to compare figures.
 */

import type { ReactNode } from "react";
import type {
  ApplicationStatus,
  Posting,
  PostingStatus,
  Track,
} from "@/domain/types";
import { creditsFor } from "@/domain/credit";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Elevation, not decoration.
 *
 * Every surface in the app used to be the same white, the same radius, the
 * same pale blue hairline and the same `shadow-sm`. That is a system with one
 * rung, and a page built on one rung cannot rank anything: a queue blocking
 * four placements, a reference table, and a skills list all sat at exactly the
 * same height off the page, so the eye had nowhere to land first.
 *
 *   sunken   a panel *inside* a card — recessed, no shadow of its own
 *   flat     nested surfaces that should read as contained, not stacked
 *   raised   the default; a card at rest
 *   floating what the page is actually for, and what hover promotes to
 */
type Elevation = "sunken" | "flat" | "raised" | "floating";

const ELEVATION: Record<Elevation, string> = {
  sunken: "bg-sunken rounded-card border border-line shadow-inset",
  flat: "bg-surface rounded-card border border-line",
  raised: "bg-surface rounded-panel border border-line shadow-e2",
  floating: "bg-surface rounded-panel border border-line shadow-e3",
};

export function Card({
  children,
  className = "",
  elevation = "raised",
  /** Lifts a rung on hover. For cards that are themselves links or buttons. */
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  elevation?: Elevation;
  interactive?: boolean;
}) {
  return (
    <div
      className={`${ELEVATION[elevation]} ${
        interactive
          ? "transition-[box-shadow,transform,border-color] duration-200 hover:shadow-e4 hover:border-line-strong hover:-translate-y-0.5"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A card whose left edge carries its state.
 *
 * A queue that is on fire and a queue that is empty were previously the same
 * white rectangle with a differently-coloured word in the header. The rail is
 * the cheapest way to make severity survive peripheral vision — it reads
 * before the text does, and it costs no vertical space.
 */
export function ToneCard({
  children,
  tone,
  className = "",
  elevation = "raised",
}: {
  children: ReactNode;
  tone: "brand" | "good" | "warn" | "crit" | "micro";
  className?: string;
  elevation?: Elevation;
}) {
  const rails = {
    brand: "before:bg-brand-500",
    good: "before:bg-good-600",
    warn: "before:bg-warn-600",
    crit: "before:bg-crit-600",
    micro: "before:bg-micro-600",
  };
  return (
    <div
      className={`relative overflow-hidden ${ELEVATION[elevation]} before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] ${rails[tone]} ${className}`}
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
    /* The header sits on its own tint rather than on the card's white. A
       hairline alone left the title floating in the same plane as the rows
       beneath it, so a long list read as starting at the top of the card. */
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line bg-gradient-to-b from-canvas/60 to-transparent rounded-t-[inherit]">
      <div className="flex items-start gap-3.5">
        {icon && (
          /* Boxed rather than bare. A loose 16px glyph next to 16px text is
             just another word in the line; the tile gives the title an anchor
             and tells you the card has a subject. */
          <span className="shrink-0 grid place-items-center w-9 h-9 rounded-card bg-brand-50 text-brand-700 ring-1 ring-brand-100">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <Heading className="text-[0.95rem] font-bold text-ink-950 text-balance">
            {title}
          </Heading>
          {subtitle && (
            <p className="text-sm text-ink-500 mt-0.5 text-pretty">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
    <section className={settings ? "border-t border-line-strong pt-8 mt-4" : ""}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div className="min-w-0">
          {settings ? (
            <h2 className="text-xs font-bold text-ink-500 uppercase tracking-widest">
              {title}
            </h2>
          ) : (
            /* A zone heading has to out-rank the card headings under it, and
               `text-lg font-black` against `text-base font-bold` was not
               enough of a step to be read as a level. The rule carries the
               rest of it — the zone now has a visible top edge instead of
               relying on the reader inferring one from spacing. */
            <h2 className="flex items-center gap-3 text-xl font-black text-ink-950 tracking-tight">
              <span
                aria-hidden="true"
                className="h-5 w-1 rounded-full bg-brand-600"
              />
              {title}
            </h2>
          )}
          {description && (
            <p
              className={`text-sm text-ink-500 mt-1.5 max-w-2xl text-pretty ${
                settings ? "" : "pl-4"
              }`}
            >
              {description}
            </p>
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
    /* The masthead of a portal, and the one surface allowed to be loud.
       Previously it was the same white card as everything under it, which
       meant a portal opened on nothing in particular — the eye had no entry
       point and started at whichever card happened to be busiest. */
    <div
      className={`relative overflow-hidden rounded-hero px-8 py-8 sm:px-10 sm:py-9 flex flex-wrap items-center justify-between gap-5 ${
        dark
          ? "bg-ink-950 text-white shadow-dark"
          : "bg-surface border border-line shadow-e3"
      }`}
    >
      {/* Light from the top-left, and a brand wash bleeding off the right
          edge. Enough to give a flat rectangle a direction without becoming
          a decorated box. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl ${
          dark ? "bg-brand-500/25" : "bg-brand-400/15"
        }`}
      />
      {!dark && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-200 to-transparent"
        />
      )}

      <div className="relative min-w-0">
        <span
          className={`inline-flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.14em] ${
            dark ? "text-brand-400" : "text-brand-700"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              dark ? "bg-brand-400" : "bg-brand-600"
            }`}
          />
          {eyebrow}
        </span>
        <h1
          className={`text-[1.75rem] sm:text-4xl font-black mt-2 text-balance tracking-tight leading-[1.1] ${
            dark ? "text-white" : "text-ink-950"
          }`}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={`text-sm mt-2.5 text-pretty ${
              dark ? "text-ink-400" : "text-ink-500"
            }`}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="relative shrink-0">{action}</div>}
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

  // The tone reaches the tile itself, not only the digits. A row of four
  // identical boxes distinguished by the colour of one number makes the
  // reader compare them one at a time; a tinted top edge sorts the row at a
  // glance, which is the only reason to put stats in a row.
  const rail = {
    neutral: "bg-ink-200",
    good: "bg-good-600",
    warn: "bg-warn-600",
    crit: "bg-crit-600",
    brand: "bg-brand-600",
  }[tone];

  return (
    <Card
      elevation="raised"
      // `h-full` so a two-line label ("Participating employers") does not make
      // its tile shorter than its neighbours and break the row's baseline.
      className="relative overflow-hidden p-5 h-full flex flex-col"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-0.5 ${rail}`}
      />
      <p className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em] leading-tight">
        {label}
      </p>
      <p className={`text-[2rem] leading-none font-black mt-3 tabular ${valueTone}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-ink-500 mt-2 text-pretty">{hint}</p>}
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
    neutral: "bg-ink-100 text-ink-700 border-line-strong",
    brand: "bg-brand-50 text-brand-700 border-brand-200",
    good: "bg-good-50 text-good-700 border-good-100",
    warn: "bg-warn-50 text-warn-700 border-warn-100",
    crit: "bg-crit-50 text-crit-700 border-crit-100",
    micro: "bg-micro-50 text-micro-700 border-micro-100",
  };
  return (
    // A pill, not a small card. At `rounded-lg` a badge shared its corner with
    // the card behind it and read as a nested panel; the full round is what
    // makes it read as a label attached to the text beside it.
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap ${tones[tone]}`}
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
 * A posting's own status, which is a different vocabulary from an
 * application's.
 *
 * Separate rather than folded into `STATUS_META` because the two share words
 * that mean different things — `closed` on an application is bookkeeping after
 * credit is granted, and on a posting it means nobody can apply any more.
 * Merging them would give one label to two facts.
 *
 * Written out here rather than per page: the employer's list and the
 * opportunity page both need it, and the second call site is where a private
 * lookup table becomes a component.
 */
export const POSTING_STATUS_META: Record<
  PostingStatus,
  { label: string; tone: BadgeTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  help_requested: { label: "With the college", tone: "warn" },
  college_drafting: { label: "College drafting", tone: "brand" },
  pending_review: { label: "Awaiting review", tone: "warn" },
  changes_requested: { label: "Changes requested", tone: "warn" },
  published: { label: "Live", tone: "good" },
  filled: { label: "Filled", tone: "brand" },
  closed: { label: "Closed", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

export function PostingStatusBadge({ status }: { status: PostingStatus }) {
  const meta = POSTING_STATUS_META[status];
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
  // Filled buttons get a top highlight and a coloured shadow, so they read as
  // raised rather than as a rectangle of flat colour. The shadow is tinted
  // with the button's own hue — a grey drop shadow under a blue button is the
  // thing that makes a UI look printed rather than lit.
  const variants = {
    primary:
      "bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_1px_2px_rgb(15_23_42/0.12),0_4px_12px_-4px_rgb(3_105_161/0.5)] hover:from-brand-700 hover:to-ink-950 hover:shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_2px_4px_rgb(15_23_42/0.16),0_8px_20px_-6px_rgb(3_105_161/0.55)] active:translate-y-px",
    dark: "bg-gradient-to-b from-ink-700 to-ink-950 text-white shadow-[0_1px_0_rgb(255_255_255/0.14)_inset,0_1px_2px_rgb(15_23_42/0.2),0_4px_12px_-4px_rgb(2_6_23/0.5)] hover:from-brand-600 hover:to-brand-700 active:translate-y-px",
    ghost:
      "bg-surface text-ink-950 border border-line-strong shadow-e1 hover:bg-canvas hover:border-ink-400 active:translate-y-px",
    quiet: "bg-transparent text-brand-700 hover:text-ink-950 hover:underline",
    // Reserved for irreversible actions, so the colour keeps its meaning.
    danger:
      "bg-gradient-to-b from-crit-600 to-crit-700 text-white shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_1px_2px_rgb(15_23_42/0.12),0_4px_12px_-4px_rgb(220_38_38/0.45)] hover:from-crit-700 hover:to-crit-700 active:translate-y-px",
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
      className={`whitespace-nowrap rounded-card font-bold transition-[background,box-shadow,transform,border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:translate-y-0 ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** `.scroll-x` adds the edge fades that say the table continues past the frame. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="scroll-x">{children}</div>;
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="py-2.5 px-4 text-left text-[0.7rem] font-extrabold text-ink-500 uppercase tracking-[0.1em] whitespace-nowrap bg-canvas/50">
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

/**
 * Nothing here — said as a resolved state rather than as a gap.
 *
 * Centred grey text in an otherwise empty card is indistinguishable from a
 * card that failed to load. The dotted well gives the absence an edge, so it
 * reads as "this queue is clear" instead of "something is missing".
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-8">
      <div className="rounded-card border border-dashed border-line-strong bg-sunken/60 px-6 py-8 text-center text-sm text-ink-500 text-pretty">
        {children}
      </div>
    </div>
  );
}

/**
 * A visible marker for a design decision standing in for an unanswered
 * question. Cheap to find, cheap to reverse.
 */
export function Assumption({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-ink-600 border-l-2 border-warn-600 bg-warn-50/50 rounded-r-card pl-3.5 pr-4 py-2.5 text-pretty">
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
  // A groove and a lit fill, rather than two flat bars stacked. The track is
  // the one place in the app where something should read as *below* the page.
  const fills = {
    brand: "bg-gradient-to-r from-brand-500 to-brand-600",
    good: "bg-gradient-to-r from-good-600 to-good-700",
    warn: "bg-gradient-to-r from-warn-600 to-warn-700",
    crit: "bg-gradient-to-r from-crit-600 to-crit-700",
  };
  return (
    <div
      className="h-2 w-full rounded-full bg-ink-100 shadow-inset overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={`${value} of ${max}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${fills[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
