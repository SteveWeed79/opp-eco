/**
 * What each message says.
 *
 * `notification-policy.ts` decides who is told; this decides what they read.
 * Split because the audience question and the wording question change for
 * different reasons — adding a recipient to a status should not mean editing
 * prose, and rewording a message should not risk changing who gets it.
 *
 * Three rules every template here follows:
 *
 *  1. **Name the next action.** A message that only reports a state change
 *     makes the reader work out their own next step, which is how queues
 *     stall. "Your application moved to shortlisted" is worse than "the
 *     employer wants to talk — confirm you are still interested".
 *  2. **Say who it is about.** These people carry dozens of placements. A
 *     subject line without a name and a role is unsortable.
 *  3. **Never imply money that has not been authorized.** A student reading
 *     "$20/hour" before the board has cleared them will plan around it.
 */

export interface Message {
  subject: string;
  /** Plain text. The HTML part is generated from this — see email/render.ts. */
  body: string;
  /** Where the recipient should go. Rendered as a button in the HTML part. */
  action?: { label: string; path: string };
}

type Template = (payload: Record<string, unknown>) => Message;

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function when(value: unknown): string {
  if (typeof value !== "string") return "a scheduled time";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "a scheduled time";
  return at.toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A week-starting date as something a person reads. */
function week(value: unknown): string {
  if (typeof value !== "string") return "that week";
  const at = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return "that week";
  return at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const TEMPLATES: Record<string, Template> = {
  // --- Application received ------------------------------------------------
  "application.submitted.student": (p) => ({
    subject: `Application sent: ${str(p.postingTitle)}`,
    body:
      `${str(p.employerName)} has your application for ${str(p.postingTitle)}. ` +
      `Nothing is needed from you until they respond. If they are interested you will hear from us, not from a portal you have to remember to check.`,
    action: { label: "View your applications", path: "/student" },
  }),
  "application.submitted": (p) => ({
    subject: `New applicant for ${str(p.postingTitle)}`,
    body:
      `${str(p.studentName)} applied for ${str(p.postingTitle)}. ` +
      `Reviewing promptly is the single biggest thing you can do to keep a candidate engaged — most withdrawals happen while waiting for a first response.`,
    action: { label: "Review the candidate", path: "/business" },
  }),

  // --- The employer is interested ------------------------------------------
  "application.shortlisted.student": (p) => ({
    subject: `${str(p.employerName)} wants to move forward`,
    body:
      `${str(p.employerName)} shortlisted you for ${str(p.postingTitle)}. ` +
      `Confirm you are still interested and this moves to the next step. If you have taken something else, withdrawing is just as useful — it frees the place for someone else.`,
    action: { label: "Confirm your interest", path: "/student" },
  }),

  // --- Mutual interest: the pause ------------------------------------------
  "mutual_interest.student": (p) => {
    const micro = p.track === "micro";
    return {
      subject: micro
        ? `You and ${str(p.employerName)} are matched`
        : `Book your workforce board interview`,
      body: micro
        ? `${str(p.employerName)} is ready to assign you ${str(p.postingTitle)}. They will confirm the start; nothing is needed from you right now.`
        : `You and ${str(p.employerName)} both said yes to ${str(p.postingTitle)}. ` +
          `One step is left: a short eligibility conversation with ${str(p.boardName)}. ` +
          `This is the step where placements are lost — not because anyone says no, but because nobody books it. Pick a time and it moves.`,
      action: micro
        ? undefined
        : { label: "Book your interview", path: "/student" },
    };
  },
  "mutual_interest.employer": (p) => ({
    subject: `${str(p.studentName)} confirmed interest in ${str(p.postingTitle)}`,
    body:
      p.track === "micro"
        ? `${str(p.studentName)} is ready to start ${str(p.postingTitle)}. Assign the project when you are.`
        : `${str(p.studentName)} is now booking an eligibility interview with ${str(p.boardName)}. ` +
          `Once the board clears them and authorizes funding, the placement can start and your wage cost is reimbursed.`,
    action: { label: "View the pipeline", path: "/business" },
  }),
  "mutual_interest.board": (p) => ({
    subject: `Clearance needed: ${str(p.studentName)}`,
    body:
      `${str(p.studentName)} reached mutual interest with ${str(p.employerName)} for ${str(p.postingTitle)} ` +
      `and needs an eligibility determination for this placement. ` +
      `Clearance is per applicant per job, so this is a fresh determination even if you have seen this student before.`,
    action: { label: "Open the board queue", path: "/board" },
  }),

  // --- Interview -----------------------------------------------------------
  "interview.booked.student": (p) => ({
    subject: `Interview booked for ${when(p.startsAt)}`,
    body:
      `Your eligibility interview with ${str(p.boardName)} is ${when(p.startsAt)}` +
      (str(p.officerName) ? ` with ${str(p.officerName)}` : "") +
      `. This determines whether the board funds your placement at ${str(p.employerName)}. Bring nothing; it is a conversation, not an exam.`,
    action: { label: "See the details", path: "/student" },
  }),
  "interview.booked.board": (p) => ({
    subject: `Interview booked: ${str(p.studentName)}`,
    body:
      `${str(p.studentName)} booked a clearance interview for ${str(p.postingTitle)} at ${str(p.employerName)}, ` +
      `on ${when(p.startsAt)}. Nothing else is needed until then.`,
    action: { label: "Open the board queue", path: "/board" },
  }),
  "interview.booked.employer": (p) => ({
    subject: `Your candidate booked their board interview`,
    body:
      `${str(p.studentName)}'s clearance interview for ${str(p.postingTitle)} is ${when(p.startsAt)}. ` +
      `Once the board authorizes funding, the placement can start.`,
    action: { label: "View the pipeline", path: "/business" },
  }),

  // --- Clearance -----------------------------------------------------------
  "clearance.granted.student": (p) => ({
    subject: `You are cleared for ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} determined you eligible for this placement at ${str(p.employerName)}. ` +
      `The board decides the funding amount next, and then the placement can start.`,
    action: { label: "View your applications", path: "/student" },
  }),
  "clearance.granted.employer": (p) => ({
    subject: `${str(p.studentName)} cleared for ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} cleared ${str(p.studentName)} for this placement. ` +
      `Funding authorization is the next step; you will hear the hour cap once it is set.`,
    action: { label: "View the pipeline", path: "/business" },
  }),
  "clearance.declined.student": (p) => ({
    subject: `Funding decision for ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} will not be funding this placement. ` +
      `That is a decision about the subsidy, not about you or the role — ${str(p.employerName)} can still take you on unsubsidised, and the placement still earns credit if it goes ahead.`,
    action: { label: "View your applications", path: "/student" },
  }),
  "clearance.declined.employer": (p) => ({
    subject: `No board funding for ${str(p.studentName)}`,
    body:
      `${str(p.boardName)} will not be reimbursing wages for this placement. ` +
      `You can still start it unsubsidised — the credit and the supervision requirements are unchanged, only the reimbursement is.`,
    action: { label: "View the pipeline", path: "/business" },
  }),

  // --- Funding -------------------------------------------------------------
  "funding.authorized": (p) => ({
    subject: `Funding approved for ${str(p.studentName)}`,
    body:
      `${str(p.boardName)} authorized up to ${num(p.hours) ?? "the posted"} hours at $${num(p.rate) ?? num(p.ratePerHour)}/hour for ${str(p.postingTitle)}. ` +
      `You can start the placement and log hours against it. This is a cap, not a payment — anything unused returns to the allocation.`,
    action: { label: "Start the placement", path: "/business" },
  }),
  "funding.authorized.student": (p) => ({
    subject: `Your placement is funded`,
    body:
      `${str(p.boardName)} authorized funding for ${str(p.postingTitle)} at ${str(p.employerName)}. ` +
      `They can start you now. Your hours count toward credit as you log them.`,
    action: { label: "View your applications", path: "/student" },
  }),

  // --- The work ------------------------------------------------------------
  "placement.started.student": (p) => ({
    subject: `Your placement at ${str(p.employerName)} has started`,
    body:
      `${str(p.postingTitle)} is now active. Log your hours as you work them — ` +
      `credit is awarded against approved hours, and reconstructing a semester from memory at the end never goes well.`,
    action: { label: "Log hours", path: "/student" },
  }),
  "placement.started.college": (p) => ({
    subject: `Placement started: ${str(p.studentName)}`,
    body:
      `${str(p.studentName)} started ${str(p.postingTitle)} at ${str(p.employerName)}. ` +
      `Nothing is needed from you until the work is complete and they submit for credit.`,
    action: { label: "Open the college portal", path: "/college" },
  }),
  "placement.completed.student": (p) => ({
    subject: `Placement complete — submit for credit`,
    body:
      `${str(p.employerName)} marked ${str(p.postingTitle)} complete. ` +
      `Submit it for credit and ${str(p.collegeName)} will make the award decision. Work that is never submitted earns nothing.`,
    action: { label: "Submit for credit", path: "/student" },
  }),
  "placement.completed.college": (p) => ({
    subject: `${str(p.studentName)} completed ${str(p.postingTitle)}`,
    body:
      `The placement at ${str(p.employerName)} is finished. ` +
      `A credit decision is due once the student submits it.`,
    action: { label: "Open the college portal", path: "/college" },
  }),

  // --- Credit --------------------------------------------------------------
  "credit.pending.college": (p) => ({
    subject: `Credit decision waiting: ${str(p.studentName)}`,
    body:
      `${str(p.studentName)} submitted ${str(p.postingTitle)} for credit. ` +
      `This is the last step of the whole process — a student who completed the work and never received the credit has had the worst possible experience of this program.`,
    action: { label: "Review the credit queue", path: "/college" },
  }),
  "credit.granted": (p) => ({
    subject: `Credit granted for ${str(p.postingTitle)}`,
    body:
      `${str(p.collegeName)} granted credit for your placement at ${str(p.employerName)}. ` +
      `It will appear on your record through your college's normal process.`,
    action: { label: "View your credits", path: "/student" },
  }),
  "credit.granted.employer": (p) => ({
    subject: `${str(p.studentName)} earned credit for their placement`,
    body:
      `${str(p.collegeName)} granted academic credit for ${str(p.postingTitle)}. ` +
      `That is the outcome this program exists to produce — thank you for hosting it.`,
    action: { label: "Post another opportunity", path: "/business" },
  }),
  "credit.denied.student": (p) => ({
    subject: `Credit decision for ${str(p.postingTitle)}`,
    body:
      `${str(p.collegeName)} did not grant credit for this placement. ` +
      `Your college can explain what was missing and whether anything can be done — this is a conversation to have with them directly.`,
    action: { label: "View your applications", path: "/student" },
  }),

  // --- Endings -------------------------------------------------------------
  "application.rejected.student": (p) => ({
    subject: `Update on ${str(p.postingTitle)}`,
    body:
      `${str(p.employerName)} is not moving forward with your application. ` +
      `This says nothing about your other applications, and there are open opportunities that match your skills.`,
    action: { label: "See other opportunities", path: "/student" },
  }),
  "application.withdrawn.employer": (p) => ({
    subject: `${str(p.studentName)} withdrew from ${str(p.postingTitle)}`,
    body: `They are no longer a candidate for this posting. Your other applicants are unaffected.`,
    action: { label: "View the pipeline", path: "/business" },
  }),
  "placement.terminated.student": (p) => ({
    subject: `${str(p.postingTitle)} has ended`,
    body:
      `This placement ended early. Hours you already logged and had approved are not lost — ` +
      `talk to ${str(p.collegeName)} about what they count toward.`,
    action: { label: "View your applications", path: "/student" },
  }),
  "placement.terminated.college": (p) => ({
    subject: `Placement ended early: ${str(p.studentName)}`,
    body:
      `${str(p.postingTitle)} at ${str(p.employerName)} ended before completion. ` +
      `The student may need advising about what their approved hours count toward.`,
    action: { label: "Open the college portal", path: "/college" },
  }),
  "placement.terminated.board": (p) => ({
    subject: `Release funding: ${str(p.studentName)}`,
    body:
      `${str(p.postingTitle)} ended early, so the authorized hours will not be used in full. ` +
      `The unspent commitment can return to this program year's allocation.`,
    action: { label: "Open the board queue", path: "/board" },
  }),

  // --- Postings ------------------------------------------------------------
  "posting.submitted": (p) => ({
    subject: `${str(p.businessName)} submitted a posting for review`,
    body:
      `"${str(p.postingTitle)}" is waiting on your review before students can see it. ` +
      (p.selfSufficient
        ? `It clears your hours-per-credit threshold on its own.`
        : `It is below your threshold, so it will need to stack with other work to carry credit.`),
    action: { label: "Review the posting", path: "/college" },
  }),

  // --- Hours ---------------------------------------------------------------
  // The one exchange that repeats every week of a placement, which makes the
  // wording matter more than it does for a one-off status change. A supervisor
  // who has to open a portal to find out what they are approving will approve
  // it unread, and an approval nobody looked at is not a validation.
  "hours.submitted": (p) => ({
    subject: `${str(p.studentName)} logged ${num(p.hours) ?? "some"} hours — week of ${week(p.weekStarting)}`,
    body:
      `${str(p.studentName)} submitted ${num(p.hours) ?? "some"} hours for ${str(p.postingTitle)}, week beginning ${week(p.weekStarting)}. ` +
      `Approving confirms they worked those hours. It is what the workforce board reimburses against and what the college counts toward credit, ` +
      `so please send it back if anything looks wrong rather than approving to clear the queue.`,
    action: { label: "Review the week", path: "/business" },
  }),
  "hours.approved": (p) => ({
    subject: `${num(p.hours) ?? "Your"} hours approved — week of ${week(p.weekStarting)}`,
    body:
      `Your supervisor approved ${num(p.hours) ?? "your"} hours for the week beginning ${week(p.weekStarting)}. ` +
      `They now count toward your credit total. Nothing is needed from you.`,
    action: { label: "View your hours", path: "/student" },
  }),
  "hours.rejected": (p) => ({
    subject: `Please correct your hours — week of ${week(p.weekStarting)}`,
    body:
      `Your supervisor sent back the ${num(p.hours) ?? ""} hours you logged for the week beginning ${week(p.weekStarting)}.` +
      (str(p.note) ? `\n\nWhat they said: "${str(p.note)}"` : "") +
      `\n\nYou can log that week again with the correction. Sent-back hours do not count toward your credit until they are resubmitted and approved.`,
    action: { label: "Correct the week", path: "/student" },
  }),

  // --- Verification --------------------------------------------------------
  "student.verified": (p) => ({
    subject: "You're verified — you can start applying",
    body:
      `${str(p.collegeName, "Your college")} has verified your enrollment, which is what employers rely on when they look at your application. ` +
      `You can now apply to any published opportunity in your market.`,
    action: { label: "Browse opportunities", path: "/student" },
  }),
  "student.rejected": (p) => ({
    subject: "Your verification needs another look",
    body:
      `${str(p.collegeName, "Your college")} could not verify your enrollment as submitted.` +
      (str(p.reason) ? `\n\nWhat they said: "${str(p.reason)}"` : "") +
      `\n\nThis is not final — correct what they mentioned and submit again. Your profile and any applications you have already made are unaffected.`,
    action: { label: "Open your profile", path: "/student" },
  }),

  // --- Vetting -------------------------------------------------------------
  "organization.approved": (p) => ({
    subject: `${str(p.organizationName)} is approved`,
    body:
      `Vetting is complete and ${str(p.organizationName)} can now take part in the program. ` +
      `You can post opportunities, review candidates, and approve intern hours.`,
    action: { label: "Open your portal", path: "/business" },
  }),
  "organization.info_requested": (p) => ({
    subject: `More information needed for ${str(p.organizationName)}`,
    body:
      `The program administrator needs something more before vetting can finish.` +
      (str(p.reason) ? `\n\nWhat they asked for: "${str(p.reason)}"` : "") +
      `\n\nNothing can transact until this is resolved.`,
  }),
  "organization.rejected": (p) => ({
    subject: `${str(p.organizationName)} was not approved`,
    body:
      `The program administrator has not approved ${str(p.organizationName)} to take part.` +
      (str(p.reason) ? `\n\nReason given: "${str(p.reason)}"` : "") +
      `\n\nIf you believe this is a mistake, reply to this message and it will reach the administrator.`,
  }),
  "organization.suspended": (p) => ({
    subject: `${str(p.organizationName)} has been suspended`,
    body:
      `Activity for ${str(p.organizationName)} is paused. Existing placements are unaffected, but no new postings or approvals can be made.` +
      (str(p.reason) ? `\n\nReason given: "${str(p.reason)}"` : "") +
      `\n\nContact the program administrator to resolve this.`,
  }),

  // --- Publication ---------------------------------------------------------
  "posting.published": (p) => ({
    subject: `"${str(p.postingTitle)}" is live`,
    body:
      `The college has reviewed and published your posting. Students in your market can see and apply to it now. ` +
      `You will hear from us when someone applies — there is no queue to keep checking.`,
    action: { label: "View your postings", path: "/business" },
  }),
  "posting.changes_requested": (p) => ({
    subject: `"${str(p.postingTitle)}" needs a change before it goes live`,
    body:
      `The college reviewed your posting and asked for something to be adjusted.` +
      (str(p.reason) ? `\n\nWhat they asked for: "${str(p.reason)}"` : "") +
      `\n\nStudents cannot see it until it is resubmitted and published.`,
    action: { label: "Edit the posting", path: "/business" },
  }),
  "posting.drafting": (p) => ({
    subject: `The college is scoping "${str(p.postingTitle)}" with you`,
    body:
      `Someone at the college has picked up your request and is turning it into a posting students can apply to. ` +
      `They may be in touch about the work you want done.`,
    action: { label: "View your postings", path: "/business" },
  }),

  // --- Nudges --------------------------------------------------------------
  "application.stalled": (p) => ({
    subject: `${str(p.postingTitle)} has been waiting ${num(p.days) ?? "several"} days`,
    body:
      `This application has sat at "${str(p.status)}" for ${num(p.days) ?? "several"} days and is waiting on you. ` +
      `Placements that stall here are the ones most likely to fall through.`,
    action: { label: "Open the portal", path: "/" },
  }),
};

export function templateFor(kind: string): Template | null {
  return TEMPLATES[kind] ?? null;
}

/** Every kind this system can send. Used to check policy coverage in tests. */
export function knownKinds(): string[] {
  return Object.keys(TEMPLATES);
}
