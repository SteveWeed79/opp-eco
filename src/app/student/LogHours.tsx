"use client";

import { useId, useState, useTransition } from "react";
import { Clock, Check, CircleAlert, Hourglass } from "lucide-react";
import type { TimeEntry } from "@/domain/types";
import { Button, SelectField, TextField, TextAreaField, useToast } from "@/components/ui";
import { logPlacementHours } from "./actions";

/**
 * Where a student logs the week they worked.
 *
 * Weekly rather than daily because that is the period a workforce board
 * reimburses against, and a daily grid is a real burden for precision nobody
 * downstream consumes.
 *
 * The form says plainly that submitting is a claim and approval is someone
 * else's act. A student who believes logging hours *is* getting paid for them
 * will not chase a supervisor who has left three weeks unreviewed — and those
 * weeks are the ones that quietly never reach their credit total.
 */
export function LogHours({
  applicationId,
  postingTitle,
  entries,
  openWeeks,
}: {
  applicationId: string;
  postingTitle: string;
  entries: TimeEntry[];
  /** Mondays not already claimed, newest first. Computed server-side. */
  openWeeks: string[];
}) {
  const [week, setWeek] = useState(openWeeks[0] ?? "");
  const [hours, setHours] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const headingId = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await logPlacementHours(applicationId, week, hours, summary);
      if (result.ok) {
        toast.show("success", "Hours submitted. Your supervisor has been notified.");
        setHours("");
        setSummary("");
        setWeek(openWeeks.filter((w) => w !== week)[0] ?? "");
      } else {
        toast.show("error", result.error ?? "Could not log those hours.");
      }
    });
  }

  const awaiting = entries.filter((e) => e.status === "submitted");

  return (
    // A named region rather than an anonymous div, following the booking
    // panel: this is the action a student returns to every week, and reaching
    // it by landmark should not mean reading the whole placement card first.
    <section
      aria-labelledby={headingId}
      className="border-t border-line px-6 py-5 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-brand-700" aria-hidden="true" />
        <h4 id={headingId} className="text-sm font-bold text-ink-950">
          Your hours on {postingTitle}
        </h4>
      </div>

      {openWeeks.length === 0 ? (
        <p className="text-xs text-ink-500">
          Every week so far is logged. Come back at the end of next week.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <SelectField
              label="Week worked"
              value={week}
              required
              onChange={(e) => setWeek(e.target.value)}
              options={openWeeks.map((monday) => ({
                value: monday,
                label: `Week of ${formatWeek(monday)}`,
              }))}
            />
            <TextField
              label="Hours"
              type="number"
              inputMode="decimal"
              min="0.5"
              max="60"
              step="0.5"
              required
              value={hours}
              placeholder="15"
              onChange={(e) => setHours(e.target.value)}
              hint="To the nearest half hour."
            />
          </div>

          <TextAreaField
            label="What you worked on"
            required
            value={summary}
            placeholder="Wired the intake form and wrote the validation tests."
            onChange={(e) => setSummary(e.target.value)}
            hint={`Your supervisor at ${postingTitle} approves against this, and your college reads it when awarding credit.`}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              {pending ? "Submitting…" : "Submit for approval"}
            </Button>
            <p className="text-xs text-ink-500">
              Submitting is a claim, not an approval. Your supervisor confirms
              the hours before they count toward credit or reimbursement.
            </p>
          </div>
        </form>
      )}

      {awaiting.length > 0 && (
        <p className="text-xs text-warn-700 font-semibold">
          {awaiting.length} week{awaiting.length === 1 ? "" : "s"} waiting on your
          supervisor.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="row-list divide-y divide-line border-t border-line">
          {entries.map((entry) => (
            <WeekRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

const STATE = {
  submitted: { Icon: Hourglass, tone: "text-warn-700", label: "Awaiting approval" },
  approved: { Icon: Check, tone: "text-good-700", label: "Approved" },
  rejected: { Icon: CircleAlert, tone: "text-crit-700", label: "Sent back" },
} as const;

function WeekRow({ entry }: { entry: TimeEntry }) {
  const { Icon, tone, label } = STATE[entry.status];

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-700">
          Week of {formatWeek(entry.weekStarting)}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-xs tabular font-semibold text-ink-950">
            {entry.hours} hrs
          </span>
          <span className={`flex items-center gap-1 text-xs font-semibold ${tone}`}>
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {label}
          </span>
        </span>
      </div>
      {/* The correction, quoted. A week sent back without the reason visible
          is one the student cannot fix. */}
      {entry.status === "rejected" && entry.reviewNote && (
        <p className="text-xs text-ink-600 mt-1.5 border-l-2 border-crit-200 pl-2.5">
          {entry.reviewNote} You can log this week again with the correction.
        </p>
      )}
    </li>
  );
}

function formatWeek(monday: string): string {
  return new Date(`${monday}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
