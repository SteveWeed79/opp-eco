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
 *  2. **Say which record it is about — never who.** These people carry dozens
 *     of placements, so a message with nothing to sort on is useless. That
 *     used to be solved by putting the learner's name in the subject line, and
 *     it is the rule this file reversed: TEGL 39-11 tells anyone handling WIOA
 *     participant PII never to email it unencrypted, and a subject line is the
 *     least protected part of an email — logged by every relay, shown on a lock
 *     screen, quoted whole in every reply. A reference sorts just as well and
 *     identifies nobody. The name is one click away, behind sign-on.
 *  3. **Never imply money that has not been authorized.** A student reading
 *     "$20/hour" before the board has cleared them will plan around it.
 */

import { DEMO_ROOT, PORTAL_PATH } from "@/routes";
import { escalationKindLabel } from "@/domain/escalation";
import type { EscalationKind } from "@/domain/types";

export interface Message {
  subject: string;
  /** Plain text. The HTML part is generated from this — see email/render.ts. */
  body: string;
  /** Where the recipient should go. Rendered as a button in the HTML part. */
  action?: { label: string; path: string };
  /**
   * A standing legal notice, set apart from the message itself.
   *
   * Separate from `body` because it is not prose anybody wrote for this
   * situation — it is the same sentence every time, and the renderer sets it in
   * smaller type below the rule so it reads as a footer rather than as part of
   * the update.
   */
  notice?: string;
}

/**
 * The redisclosure notice, on every message to an employer about a learner.
 *
 * FERPA asks the institution sharing an education record to tell the recipient
 * that it is covered and may not be passed on without consent. The platform is
 * what makes that sharing easy — an employer forwarding a candidate to a
 * colleague at another company has created a problem that traces back to this
 * product — so the platform is what carries the notice.
 */
export const FERPA_NOTICE =
  "This message concerns a student's education record. It is protected under FERPA " +
  "and may not be shared outside your organization without the student's written consent.";

/**
 * A record reference a person can sort and search on, identifying nobody.
 *
 * `app-12` becomes `APP-12`. Opaque by construction, which is the same shape
 * the data rules ask for when a workforce board needs to match a participant in
 * its own system: they match on their key, and this side holds a reference.
 */
function ref(payload: Record<string, unknown>): string {
  const id = payload.applicationId;
  return typeof id === "string" && id.length > 0 ? id.toUpperCase() : "this record";
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
  // --- Working the chase queue ---------------------------------------------
  //
  // The two messages the administrator sends by pressing a button, one per
  // list on their console. Deliberately templates rather than a compose box,
  // and the reason is not convenience.
  //
  // A free-text field here would be the one place in this product where a
  // person's prose leaves the building, and the rule every other template obeys
  // — no message names the learner it is about — cannot be enforced on a
  // sentence somebody typed. `withoutParticipantPII` strips payload *keys*; a
  // name inside a string is not a key. So the nudge says nothing that needs
  // checking, and the conversation that follows happens in a reply, between two
  // people, outside a system that would otherwise have to store it.
  //
  // The employer's note is not quoted in either of these. It is readable by its
  // author and the administrator and nobody else, and a product that mails it
  // onward has undone that with one button.
  "followup.employer": (p) => ({
    subject: `Did this placement lead anywhere? — ${ref(p)}`,
    body:
      `${str(p.postingTitle, "A placement")} with you has finished, and we have not recorded what happened at the end of it (${ref(p)}).\n\n` +
      `One question: did you offer them a job? Whether the answer is yes, no, or "we offered and they went elsewhere", all three are worth as much to us — the last one especially, because nobody else can tell us it happened.\n\n` +
      `It is one click in your portal, and replying to this email reaches us directly if it is easier.`,
    action: { label: "Answer in one click", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "followup.learner": (p) => ({
    subject: `Where did you land? — ${ref(p)}`,
    body:
      `Your placement has finished (${ref(p)}) and nobody has asked you where you went next.\n\n` +
      `Whatever the answer is, it helps — including "still looking", which is counted apart from the people nobody asked, so saying it never makes anything look worse than staying quiet.\n\n` +
      `It takes about thirty seconds, and you can add to it later if things change.`,
    action: { label: "Tell us where you are", path: PORTAL_PATH.student },
  }),

  // --- Application received ------------------------------------------------
  "application.submitted.student": (p) => ({
    subject: `Application sent: ${str(p.postingTitle)}`,
    body:
      `${str(p.employerName)} has your application for ${str(p.postingTitle)}. ` +
      `Nothing is needed from you until they respond. If they are interested you will hear from us, not from a portal you have to remember to check.`,
    action: { label: "View your applications", path: PORTAL_PATH.student },
  }),
  "application.submitted": (p) => ({
    subject: `New applicant for ${str(p.postingTitle)}`,
    body:
      `A candidate applied for ${str(p.postingTitle)} (${ref(p)}). ` +
      `Reviewing promptly is the single biggest thing you can do to keep a candidate engaged — most withdrawals happen while waiting for a first response.`,
    action: { label: "Review the candidate", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),

  // --- The employer is interested ------------------------------------------
  "application.shortlisted.student": (p) => ({
    subject: `${str(p.employerName)} wants to move forward`,
    body:
      `${str(p.employerName)} shortlisted you for ${str(p.postingTitle)}. ` +
      `Confirm you are still interested and this moves to the next step. If you have taken something else, withdrawing is just as useful — it frees the place for someone else.`,
    action: { label: "Confirm your interest", path: PORTAL_PATH.student },
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
        : { label: "Book your interview", path: PORTAL_PATH.student },
    };
  },
  "mutual_interest.employer": (p) => ({
    subject: `Candidate confirmed interest — ${str(p.postingTitle)}`,
    body:
      p.track === "micro"
        ? `Your candidate is ready to start ${str(p.postingTitle)}. Assign the project when you are.`
        : `Your candidate is now booking an eligibility interview with ${str(p.boardName)}. ` +
          `Once the board clears them and authorizes funding, the placement can start and your wage cost is reimbursed.`,
    action: { label: "View the pipeline", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "mutual_interest.board": (p) => ({
    subject: `Clearance needed — ${ref(p)}`,
    body:
      `An applicant reached mutual interest with ${str(p.employerName)} for ${str(p.postingTitle)} ` +
      `and needs an eligibility determination for this placement. ` +
      `Clearance is per applicant per job, so this is a fresh determination even if you have seen this student before.`,
    action: { label: "Open the board queue", path: PORTAL_PATH.board },
  }),

  // --- Interview -----------------------------------------------------------
  "interview.booked.student": (p) => ({
    subject: `Interview booked for ${when(p.startsAt)}`,
    body:
      `Your eligibility interview with ${str(p.boardName)} is ${when(p.startsAt)}` +
      (str(p.officerName) ? ` with ${str(p.officerName)}` : "") +
      `. This determines whether the board funds your placement at ${str(p.employerName)}. Bring nothing; it is a conversation, not an exam.`,
    action: { label: "See the details", path: PORTAL_PATH.student },
  }),
  "interview.booked.board": (p) => ({
    subject: `Interview booked — ${ref(p)}`,
    body:
      `An applicant booked a clearance interview for ${str(p.postingTitle)} at ${str(p.employerName)}, ` +
      `on ${when(p.startsAt)}. Nothing else is needed until then.`,
    action: { label: "Open the board queue", path: PORTAL_PATH.board },
  }),
  "interview.booked.employer": (p) => ({
    subject: `Your candidate booked their board interview`,
    body:
      `Your candidate's clearance interview for ${str(p.postingTitle)} is ${when(p.startsAt)}. ` +
      `Once the board authorizes funding, the placement can start.`,
    action: { label: "View the pipeline", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),

  // --- Clearance -----------------------------------------------------------
  "clearance.granted.student": (p) => ({
    subject: `You are cleared for ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} determined you eligible for this placement at ${str(p.employerName)}. ` +
      `The board decides the funding amount next, and then the placement can start.`,
    action: { label: "View your applications", path: PORTAL_PATH.student },
  }),
  "clearance.granted.employer": (p) => ({
    subject: `Candidate cleared — ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} cleared your candidate for this placement. ` +
      `Funding authorization is the next step; you will hear the hour cap once it is set.`,
    action: { label: "View the pipeline", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "clearance.declined.student": (p) => ({
    subject: `Funding decision for ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} will not be funding this placement. ` +
      `That is a decision about the subsidy, not about you or the role — ${str(p.employerName)} can still take you on unsubsidised, and the placement still earns credit if it goes ahead.`,
    action: { label: "View your applications", path: PORTAL_PATH.student },
  }),
  "clearance.declined.employer": (p) => ({
    subject: `No board funding — ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} will not be reimbursing wages for this placement. ` +
      `You can still start it unsubsidised — the credit and the supervision requirements are unchanged, only the reimbursement is.`,
    action: { label: "View the pipeline", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),

  // --- Funding -------------------------------------------------------------
  "funding.authorized": (p) => ({
    subject: `Funding approved — ${str(p.postingTitle)}`,
    body:
      `${str(p.boardName)} authorized up to ${num(p.hours) ?? "the posted"} hours at $${num(p.rate) ?? num(p.ratePerHour)}/hour for ${str(p.postingTitle)}. ` +
      `You can start the placement and log hours against it. This is a cap, not a payment — anything unused returns to the allocation.`,
    action: { label: "Start the placement", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "funding.authorized.student": (p) => ({
    subject: `Your placement is funded`,
    body:
      `${str(p.boardName)} authorized funding for ${str(p.postingTitle)} at ${str(p.employerName)}. ` +
      `They can start you now. Your hours count toward credit as you log them.`,
    action: { label: "View your applications", path: PORTAL_PATH.student },
  }),

  // --- The work ------------------------------------------------------------
  "placement.started.student": (p) => ({
    subject: `Your placement at ${str(p.employerName)} has started`,
    body:
      `${str(p.postingTitle)} is now active. Log your hours as you work them — ` +
      `credit is awarded against approved hours, and reconstructing a semester from memory at the end never goes well.`,
    action: { label: "Log hours", path: PORTAL_PATH.student },
  }),
  "placement.started.college": (p) => ({
    subject: `Placement started — ${ref(p)}`,
    body:
      `A student started ${str(p.postingTitle)} at ${str(p.employerName)}. ` +
      `Nothing is needed from you until the work is complete and they submit for credit.`,
    action: { label: "Open the college portal", path: PORTAL_PATH.college },
  }),
  "placement.completed.student": (p) => ({
    subject: `Placement complete — submit for credit`,
    body:
      `${str(p.employerName)} marked ${str(p.postingTitle)} complete. ` +
      `Submit it for credit and ${str(p.collegeName)} will make the award decision. Work that is never submitted earns nothing.`,
    action: { label: "Submit for credit", path: PORTAL_PATH.student },
  }),
  "placement.completed.college": (p) => ({
    subject: `Placement completed — ${str(p.postingTitle)}`,
    body:
      `The placement at ${str(p.employerName)} is finished. ` +
      `A credit decision is due once the student submits it.`,
    action: { label: "Open the college portal", path: PORTAL_PATH.college },
  }),

  // --- Credit --------------------------------------------------------------
  "credit.pending.college": (p) => ({
    subject: `Credit decision waiting — ${ref(p)}`,
    body:
      `A student submitted ${str(p.postingTitle)} for credit. ` +
      `This is the last step of the whole process — a student who completed the work and never received the credit has had the worst possible experience of this program.`,
    action: { label: "Review the credit queue", path: PORTAL_PATH.college },
  }),
  "credit.granted": (p) => ({
    subject: `Credit granted for ${str(p.postingTitle)}`,
    body:
      `${str(p.collegeName)} granted credit for your placement at ${str(p.employerName)}. ` +
      `It will appear on your record through your college's normal process.`,
    action: { label: "View your credits", path: PORTAL_PATH.student },
  }),
  "credit.granted.employer": (p) => ({
    subject: `Your intern earned credit for their placement`,
    body:
      `${str(p.collegeName)} granted academic credit for ${str(p.postingTitle)}. ` +
      `That is the outcome this program exists to produce — thank you for hosting it.`,
    action: { label: "Post another opportunity", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "credit.denied.student": (p) => ({
    subject: `Credit decision for ${str(p.postingTitle)}`,
    body:
      `${str(p.collegeName)} did not grant credit for this placement. ` +
      `Your college can explain what was missing and whether anything can be done — this is a conversation to have with them directly.`,
    action: { label: "View your applications", path: PORTAL_PATH.student },
  }),

  // --- Endings -------------------------------------------------------------
  "application.rejected.student": (p) => ({
    subject: `Update on ${str(p.postingTitle)}`,
    body:
      `${str(p.employerName)} is not moving forward with your application. ` +
      `This says nothing about your other applications, and there are open opportunities that match your skills.`,
    action: { label: "See other opportunities", path: PORTAL_PATH.student },
  }),
  "application.withdrawn.employer": (p) => ({
    subject: `A candidate withdrew from ${str(p.postingTitle)}`,
    body: `They are no longer a candidate for this posting. Your other applicants are unaffected.`,
    action: { label: "View the pipeline", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "placement.terminated.student": (p) => ({
    subject: `${str(p.postingTitle)} has ended`,
    body:
      `This placement ended early. Hours you already logged and had approved are not lost — ` +
      `talk to ${str(p.collegeName)} about what they count toward.`,
    action: { label: "View your applications", path: PORTAL_PATH.student },
  }),
  "placement.terminated.college": (p) => ({
    subject: `Placement ended early — ${ref(p)}`,
    body:
      `${str(p.postingTitle)} at ${str(p.employerName)} ended before completion. ` +
      `The student may need advising about what their approved hours count toward.`,
    action: { label: "Open the college portal", path: PORTAL_PATH.college },
  }),
  "placement.terminated.board": (p) => ({
    subject: `Release funding — ${ref(p)}`,
    body:
      `${str(p.postingTitle)} ended early, so the authorized hours will not be used in full. ` +
      `The unspent commitment can return to this program year's allocation.`,
    action: { label: "Open the board queue", path: PORTAL_PATH.board },
  }),

  // --- Postings ------------------------------------------------------------
  "posting.submitted": (p) => ({
    subject: `${str(p.businessName)} submitted a posting for review`,
    body:
      `"${str(p.postingTitle)}" is waiting on your review before students can see it. ` +
      (p.selfSufficient
        ? `It clears your hours-per-credit threshold on its own.`
        : `It is below your threshold, so it will need to stack with other work to carry credit.`),
    action: { label: "Review the posting", path: PORTAL_PATH.college },
  }),

  // --- Mentorship ----------------------------------------------------------
  // Addressed to the college, because it is the only party that can act on it.
  // A mentorship has no application to review and no student attached yet —
  // what exists is an employer willing to spend an hour, and an intermediary
  // who knows which student needs it.
  "mentorship.offered": (p) => ({
    subject: `${str(p.businessName)} is offering to mentor students`,
    body:
      `${str(p.mentorName)} (${str(p.mentorRole)}) at ${str(p.businessName)} has offered ${str(p.formatLabel).toLowerCase()}, for up to ${num(p.capacity) ?? "a few"} student${num(p.capacity) === 1 ? "" : "s"}. ` +
      `This carries no credit, no wage, and no board clearance, so nothing needs approving — it is a name to put in front of the students who have been asking for one.`,
    action: { label: "See who is offering", path: PORTAL_PATH.college },
  }),

  // The introduction itself, which goes to both sides at once. Neither message
  // is a notification about a queue: the employer is being told a real person
  // is about to contact them, and the student is being told who to contact and
  // what they are allowed to ask for. A student who gets a name with no idea
  // what to say with it does not send the email.
  "mentorship.introduced.employer": (p) => ({
    subject: `A student would like to take you up on your offer`,
    body:
      `${str(p.collegeName)} has introduced a student for ${str(p.formatLabel).toLowerCase()} with ${str(p.mentorName)}. ` +
      `They will be in touch directly. Nothing here needs approving and nothing is being claimed against your time beyond what you offered — ` +
      `if now is not the moment, say so and the college will find another mentor rather than leaving the student waiting.`,
    action: { label: "See your introductions", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),

  "mentorship.introduced.student": (p) => ({
    subject: `You have been introduced to ${str(p.mentorName)} at ${str(p.businessName)}`,
    body:
      `${str(p.mentorName)}, ${str(p.mentorRole)} at ${str(p.businessName)}, has agreed to ${str(p.formatLabel).toLowerCase()} with you. ` +
      `They are expecting you to make contact. This is not an interview and there is no application attached to it — ` +
      `ask them what the work is actually like, what they look for in a first hire, and what you should be learning now.`,
    action: { label: "See the introduction", path: PORTAL_PATH.student },
  }),

  // --- Hours ---------------------------------------------------------------
  // The one exchange that repeats every week of a placement, which makes the
  // wording matter more than it does for a one-off status change. A supervisor
  // who has to open a portal to find out what they are approving will approve
  // it unread, and an approval nobody looked at is not a validation.
  "hours.submitted": (p) => ({
    subject: `${num(p.hours) ?? "Some"} hours to review — week of ${week(p.weekStarting)}`,
    body:
      `Your intern submitted ${num(p.hours) ?? "some"} hours for ${str(p.postingTitle)}, week beginning ${week(p.weekStarting)}. ` +
      `Approving confirms they worked those hours. It is what the workforce board reimburses against and what the college counts toward credit, ` +
      `so please send it back if anything looks wrong rather than approving to clear the queue.`,
    action: { label: "Review the week", path: PORTAL_PATH.business },
    notice: FERPA_NOTICE,
  }),
  "hours.approved": (p) => ({
    subject: `${num(p.hours) ?? "Your"} hours approved — week of ${week(p.weekStarting)}`,
    body:
      `Your supervisor approved ${num(p.hours) ?? "your"} hours for the week beginning ${week(p.weekStarting)}. ` +
      `They now count toward your credit total. Nothing is needed from you.`,
    action: { label: "View your hours", path: PORTAL_PATH.student },
  }),
  "hours.rejected": (p) => ({
    subject: `Please correct your hours — week of ${week(p.weekStarting)}`,
    body:
      `Your supervisor sent back the ${num(p.hours) ?? ""} hours you logged for the week beginning ${week(p.weekStarting)}.` +
      (str(p.note) ? `\n\nWhat they said: "${str(p.note)}"` : "") +
      `\n\nYou can log that week again with the correction. Sent-back hours do not count toward your credit until they are resubmitted and approved.`,
    action: { label: "Correct the week", path: PORTAL_PATH.student },
  }),

  // --- Verification --------------------------------------------------------
  "student.verified": (p) => ({
    subject: "You're verified — you can start applying",
    body:
      `${str(p.collegeName, "Your college")} has verified your enrollment, which is what employers rely on when they look at your application. ` +
      `You can now apply to any published opportunity in your market.`,
    action: { label: "Browse opportunities", path: PORTAL_PATH.student },
  }),
  "student.rejected": (p) => ({
    subject: "Your verification needs another look",
    body:
      `${str(p.collegeName, "Your college")} could not verify your enrollment as submitted.` +
      (str(p.reason) ? `\n\nWhat they said: "${str(p.reason)}"` : "") +
      `\n\nThis is not final — correct what they mentioned and submit again. Your profile and any applications you have already made are unaffected.`,
    action: { label: "Open your profile", path: PORTAL_PATH.student },
  }),

  // --- Vetting -------------------------------------------------------------
  "organization.approved": (p) => ({
    subject: `${str(p.organizationName)} is approved`,
    body:
      `Vetting is complete and ${str(p.organizationName)} can now take part in the program. ` +
      `You can post opportunities, review candidates, and approve intern hours.`,
    action: { label: "Open your portal", path: PORTAL_PATH.business },
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
    action: { label: "View your postings", path: PORTAL_PATH.business },
  }),
  "posting.changes_requested": (p) => ({
    subject: `"${str(p.postingTitle)}" needs a change before it goes live`,
    body:
      `The college reviewed your posting and asked for something to be adjusted.` +
      (str(p.reason) ? `\n\nWhat they asked for: "${str(p.reason)}"` : "") +
      `\n\nStudents cannot see it until it is resubmitted and published.`,
    action: { label: "Edit the posting", path: PORTAL_PATH.business },
  }),
  "posting.drafting": (p) => ({
    subject: `The college is scoping "${str(p.postingTitle)}" with you`,
    body:
      `Someone at the college has picked up your request and is turning it into a posting students can apply to. ` +
      `They may be in touch about the work you want done.`,
    action: { label: "View your postings", path: PORTAL_PATH.business },
  }),

  // --- Nudges --------------------------------------------------------------
  "application.stalled": (p) => ({
    subject: `${str(p.postingTitle)} has been waiting ${num(p.days) ?? "several"} days`,
    body:
      `This application has sat at "${str(p.status)}" for ${num(p.days) ?? "several"} days and is waiting on you. ` +
      `Placements that stall here are the ones most likely to fall through.`,
    action: { label: "Open the portal", path: DEMO_ROOT },
  }),

  // --- The operator's three -------------------------------------------------
  /*
   * Written for somebody reading a queue rather than somebody waiting on news.
   * An administrator gets these because they are the party who can act on a
   * pattern — a run of declines means the allocation is going, a run of early
   * terminations means an employer worth a visit — so each says what the event
   * is evidence *of* rather than repeating what the other parties were told.
   */
  "clearance.declined.admin": (p) => ({
    subject: `Funding declined — ${str(p.postingTitle)}`,
    body:
      `The board declined funding for this placement, and it continues unsubsidized if both sides still want it. ` +
      `On its own that is an ordinary outcome; several in a row usually means the allocation is running down, which is the thing to look at before a market quietly stops placing anybody.`,
    action: { label: "Open the console", path: PORTAL_PATH.admin },
  }),

  "placement.terminated.admin": (p) => ({
    subject: `Placement ended early — ${str(p.postingTitle)}`,
    body:
      `This placement ended before it finished. The learner, the college and the board have been told what they each need to do about it. ` +
      `You are told because ending early is the clearest failure this system produces, and the reason behind it is usually only findable while everyone still remembers.`,
    action: { label: "Open the console", path: PORTAL_PATH.admin },
    notice: FERPA_NOTICE,
  }),

  "credit.denied.admin": (p) => ({
    subject: `Credit denied — ${str(p.postingTitle)}`,
    body:
      `A learner finished a placement and their college did not award the credit. ` +
      `This is the programme's central promise failing for one person, and it is rare enough to be worth reading rather than counting.`,
    action: { label: "Open the console", path: PORTAL_PATH.admin },
    notice: FERPA_NOTICE,
  }),

  // --- The two parties who were not being told -----------------------------
  "placement.completed.board": (p) => ({
    subject: `Placement completed — ${str(p.postingTitle)}`,
    body:
      `A placement you funded has finished. The hours are approved and the commitment settles against your allocation. ` +
      `This is the number that renews a board's participation, and until now you were told when a placement stalled and when one ended early but not when one worked.`,
    action: { label: "Open your dashboard", path: PORTAL_PATH.board },
  }),

  "application.rejected.college": (p) => ({
    subject: `A learner was not shortlisted — ${str(p.postingTitle)}`,
    body:
      `${str(p.employerName)} passed on one of your learners for ${str(p.postingTitle)}. ` +
      `No action is needed for one. The reason you are told is the pattern: a learner passed over three or four times usually has something fixable in their profile, and you are the only party who can see all of it.`,
    action: { label: "Open your dashboard", path: PORTAL_PATH.college },
    notice: FERPA_NOTICE,
  }),

  "application.withdrawn.college": (p) => ({
    subject: `A learner withdrew — ${str(p.postingTitle)}`,
    body:
      `One of your learners withdrew their own application for ${str(p.postingTitle)}. ` +
      `Often it is a timetable clash, a transport problem, or cold feet about a placement nobody talked them through — all of which you can do something about, and none of which shows up anywhere else.`,
    action: { label: "Open your dashboard", path: PORTAL_PATH.college },
    notice: FERPA_NOTICE,
  }),

  // --- The micro track's hand-in -------------------------------------------
  "deliverable.submitted": (p) => {
    const round = num(p.round) ?? 1;
    return {
      subject:
        round > 1
          ? `Revised work for ${str(p.postingTitle)}`
          : `Work handed in for ${str(p.postingTitle)}`,
      body:
        (round > 1
          ? `The revised work for ${str(p.postingTitle)} is in — round ${round}. `
          : `The work for ${str(p.postingTitle)} has been handed in. `) +
        `Accepting it completes the placement and is what the college reads when it awards the credit, so a sentence about what was good is worth more here than it looks. If it is not right yet, send it back with what needs changing.`,
      action: { label: "Read the hand-in", path: PORTAL_PATH.business },
    };
  },

  "deliverable.revision_requested": (p) => ({
    subject: `${str(p.postingTitle)} — the employer asked for a change`,
    body:
      `Your work on ${str(p.postingTitle)} has come back with a note about what to change. ` +
      `This is not a rejection and the placement is still running: read what they asked for and hand it in again when you have it.`,
    action: { label: "Read what they asked for", path: PORTAL_PATH.student },
  }),

  // --- Somebody reported a problem ----------------------------------------
  /**
   * A pointer, never the report.
   *
   * Every other template here says what happened, because every other record
   * is readable by the person receiving the mail from somewhere else too. An
   * escalation is readable by exactly two parties, and **email is the least
   * private channel this system has** — it leaves the platform when it is
   * sent, and it can reach the employer the report is about in one forward.
   * So this says a problem of this kind exists and where to read it, and the
   * administrator loads one page.
   *
   * The kind is in the subject because it decides whether this is opened now
   * or after lunch, and a subject line that will not say is a subject line
   * everybody learns to ignore.
   */
  "escalation.raised": (p) => {
    const kind = escalationKindLabel(str(p.kind) as EscalationKind).toLowerCase();
    const safety = p.kind === "safety";
    return {
      subject: safety
        ? "Safety problem reported on a placement"
        : `Problem reported on a placement: ${kind}`,
      body:
        `The ${str(p.raisedByRole, "party")} on a placement reported a problem — ${kind}. ` +
        (safety
          ? "Safety reports sit at the top of your queue ahead of everything else. "
          : "") +
        "What they wrote is in the console rather than in this message: it is readable " +
        "by them and by you, and email is not a channel that can keep it that way.",
      action: { label: "Read it in the console", path: PORTAL_PATH.admin },
    };
  },
};

export function templateFor(kind: string): Template | null {
  return TEMPLATES[kind] ?? null;
}

/** Every kind this system can send. Used to check policy coverage in tests. */
export function knownKinds(): string[] {
  return Object.keys(TEMPLATES);
}
