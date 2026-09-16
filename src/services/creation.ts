/**
 * Creating applications and postings.
 *
 * The write path for *new* records, as `transitions.ts` is for existing ones.
 * Kept out of that module because the checks are different in kind: a
 * transition asks whether an actor may move something they can already see,
 * and a creation asks whether they may bring something into existence at all.
 *
 * Both go through a Store transaction so the record and its audit entry commit
 * together, and neither trusts the caller for anything the server can derive.
 */

import type {
  ActorContext,
  Application,
  HostOffer,
  HostOfferAnswer,
  InterviewSlot,
  MentorshipOffer,
  MentorshipOfferStatus,
  MentorshipPairing,
  Outcome,
  OutcomeKind,
  Posting,
  PostingStatus,
} from "@/domain/types";
import { scoreMatch } from "@/domain/matching";
import { canApply, canTransact, transactBlockReason } from "@/domain/lifecycle";
import { INTRODUCERS, placesLeft } from "@/domain/mentorship";
import { canRecordOutcome, followUpBlockReason } from "@/domain/outcome";
import { canRecordHostOffer, isHire, offerBlockReason } from "@/domain/offer";
import { repositories } from "@/data/backend";
import { store } from "@/data/backend";
import type { NotificationIntent, Store } from "@/data/store";

export type CreateResult<T> =
  | { ok: true; created: T }
  | {
      ok: false;
      error: string;
      /**
       * `invalid` is a field the caller can fix; the other three are not.
       * Worth the distinction because a form should put the first beside the
       * input that caused it and the rest at the top of the page.
       */
      code: "forbidden" | "not_found" | "duplicate" | "invalid";
    };

export interface CreationDeps {
  store: Store;
  now: () => Date;
  /** Injected so tests are not at the mercy of a counter shared across runs. */
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: CreationDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

/**
 * A student applies to a posting.
 *
 * The match score is computed here rather than accepted from the request. It
 * is shown to employers and sorts their queue, so a caller who could set their
 * own score could put themselves at the top of every list.
 */
export async function submitApplication(
  actor: ActorContext,
  postingId: string,
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<Application>> {
  if (actor.membership.role !== "student") {
    return { ok: false, error: "Only students can apply.", code: "forbidden" };
  }

  const posting = await repositories.postings.find(actor, postingId);
  if (!posting) {
    return { ok: false, error: "That opportunity is no longer listed.", code: "not_found" };
  }
  if (posting.status !== "published") {
    return {
      ok: false,
      error: "That opportunity is not open for applications.",
      code: "forbidden",
    };
  }

  const student = await repositories.students.forUser(actor, actor.user.id);
  if (!student) {
    return { ok: false, error: "No student record for this account.", code: "not_found" };
  }

  // The college portal has always said students cannot apply until verified.
  // Nothing enforced it — verification was a status the college could not
  // change and no code read. An unverified student in an employer's candidate
  // list defeats the only reason the list is trustworthy: that a college
  // stood behind the enrolment.
  if (!canApply(student)) {
    return {
      ok: false,
      error:
        "Your college has not verified your enrollment yet. Applications open once they do.",
      code: "forbidden",
    };
  }

  // Likewise for the employer's side of the transaction. A business still in
  // vetting could take applications, take a student onto their site, and
  // approve hours a board would reimburse.
  const employer = await repositories.organizations.find(actor, posting.businessId);
  if (employer && !canTransact(employer)) {
    return {
      ok: false,
      error: "That employer is not currently able to take applications.",
      code: "forbidden",
    };
  }

  // One application per student per posting. Applying twice is a mistake, not
  // a second candidacy, and it would double-count in every funnel.
  const existing = (await repositories.applications.list(actor)).find(
    (a) => a.postingId === postingId && a.studentId === student.id,
  );
  if (existing) {
    return {
      ok: false,
      error: "You have already applied to this opportunity.",
      code: "duplicate",
    };
  }

  const college = await repositories.organizations.find(actor, student.collegeId);
  const at = deps.now().toISOString();

  const application: Application = {
    id: deps.id("app"),
    marketId: posting.marketId,
    postingId: posting.id,
    studentId: student.id,
    track: posting.track,
    status: "submitted",
    furthestStatus: "submitted",
    submittedOn: at,
    statusSince: at,
    matchScore: scoreMatch(student, posting, college?.county ?? posting.county),
    version: 1,
  };

  await deps.store.transaction((uow) => {
    uow.createApplication(application);
    uow.appendAuditEvent({
      marketId: application.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "application",
      entityId: application.id,
      from: null,
      to: "submitted",
      viaOverride: false,
    });
    uow.enqueueNotification({
      marketId: application.marketId,
      recipientUserId: `contact:${posting.businessId}`,
      recipientOrganizationId: posting.businessId,
      kind: "application.submitted",
      payload: {
        // The reference, not the applicant. An employer reviewing candidates
        // sees the name on the page the button in this message opens.
        applicationId: application.id,
        postingTitle: posting.title,
        score: application.matchScore.score,
      },
    });
  });

  return { ok: true, created: application };
}

/**
 * An employer creates a posting.
 *
 * It starts at `pending_review`, never `published`. The college is the local
 * operator and reviews postings before students see them — an employer who
 * could publish directly would bypass the review that makes a posting
 * credit-bearing.
 *
 * `businessId` and `marketId` come from the actor's own membership rather than
 * the request, so an employer cannot post on a competitor's behalf or into
 * another market.
 */
export async function createPosting(
  actor: ActorContext,
  fields: Omit<Posting, "id" | "marketId" | "businessId" | "status" | "createdOn">,
  /**
   * Messages this creation causes, enqueued in the same transaction — the
   * caller cannot know the posting's id until it exists, so it receives one.
   */
  notifications?: (posting: Posting) => NotificationIntent[],
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<Posting>> {
  if (actor.membership.role !== "business") {
    return { ok: false, error: "Only employers can post.", code: "forbidden" };
  }
  const { organizationId, marketId } = actor.membership;
  if (!organizationId || !marketId) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }

  // "Nothing transacts until an organization is approved" was written on the
  // admin console and enforced nowhere. Posting is the first thing an
  // unvetted employer would do.
  const employer = await repositories.organizations.find(actor, organizationId);
  if (!employer) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }
  const blocked = transactBlockReason(employer);
  if (blocked) {
    return { ok: false, error: blocked, code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const status: PostingStatus = "pending_review";

  const posting: Posting = {
    ...fields,
    id: deps.id("post"),
    marketId,
    businessId: organizationId,
    status,
    createdOn: at,
  };

  await deps.store.transaction((uow) => {
    uow.createPosting(posting);
    uow.appendAuditEvent({
      marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "posting",
      entityId: posting.id,
      from: null,
      to: status,
      viaOverride: false,
    });
    for (const intent of notifications?.(posting) ?? []) {
      uow.enqueueNotification(intent);
    }
  });

  return { ok: true, created: posting };
}

/**
 * An employer offers to mentor students.
 *
 * It starts `open`, which is the one place this deliberately differs from
 * `createPosting`. A posting waits at `pending_review` because the college is
 * underwriting an academic claim; a mentorship carries no credit, no wage and
 * no public money, so there is nothing for a review to decide and a queue in
 * front of it would only stall the one offer an employer makes on impulse.
 *
 * Vetting still applies, and applies harder if anything. Mentorship puts an
 * adult in front of a student with no supervisor, no timesheet, and no board
 * interview in between — the checks that surround a placement are exactly the
 * ones absent here, which leaves "is this employer who they say they are" doing
 * all the work.
 */
export async function offerMentorship(
  actor: ActorContext,
  fields: Omit<
    MentorshipOffer,
    "id" | "marketId" | "businessId" | "status" | "createdOn"
  >,
  /** Enqueued in the same transaction; the caller cannot know the id yet. */
  notifications?: (offer: MentorshipOffer) => NotificationIntent[],
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<MentorshipOffer>> {
  if (actor.membership.role !== "business") {
    return { ok: false, error: "Only employers can offer mentorship.", code: "forbidden" };
  }
  const { organizationId, marketId } = actor.membership;
  if (!organizationId || !marketId) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }

  const employer = await repositories.organizations.find(actor, organizationId);
  if (!employer) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }
  const blocked = transactBlockReason(employer);
  if (blocked) {
    return { ok: false, error: blocked, code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const status: MentorshipOfferStatus = "open";

  const offer: MentorshipOffer = {
    ...fields,
    id: deps.id("men"),
    marketId,
    businessId: organizationId,
    status,
    createdOn: at,
  };

  await deps.store.transaction((uow) => {
    uow.createMentorshipOffer(offer);
    uow.appendAuditEvent({
      marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "mentorship_offer",
      entityId: offer.id,
      from: null,
      to: status,
      viaOverride: false,
    });
    for (const intent of notifications?.(offer) ?? []) {
      uow.enqueueNotification(intent);
    }
  });

  return { ok: true, created: offer };
}


// ---------------------------------------------------------------------------
// Introductions
// ---------------------------------------------------------------------------

/**
 * Introduce a student to a mentor.
 *
 * The college or an administrator, and nobody else — see `INTRODUCERS`. This is
 * a creation rather than a transition because before it there is no record at
 * all: the college's mentor list was a list precisely because the introduction
 * left no trace, so `capacity` was unverifiable and a mentorship could not
 * count toward anything.
 *
 * Every check here is one the schema also holds, which is deliberate: the
 * refusals below exist to say something a person can act on, and the
 * constraints exist because a message is not an enforcement.
 */
export async function introduceStudentToMentor(
  actor: ActorContext,
  offerId: string,
  studentId: string,
  /** Enqueued in the same transaction; the caller cannot know the id yet. */
  notifications?: (pairing: MentorshipPairing, offer: MentorshipOffer) => NotificationIntent[],
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<MentorshipPairing>> {
  if (!INTRODUCERS.includes(actor.membership.role)) {
    return {
      ok: false,
      error: "Only the college or an administrator can make an introduction.",
      code: "forbidden",
    };
  }

  const offer = await repositories.mentorshipOffers.find(actor, offerId);
  if (!offer) {
    return { ok: false, error: "Mentorship offer not found.", code: "not_found" };
  }
  if (offer.status !== "open") {
    return {
      ok: false,
      // A paused employer said "not this term" rather than "no". Saying which
      // is the difference between a college trying again and giving up.
      error:
        offer.status === "paused"
          ? "That mentor has paused their offer, so they are not taking students right now."
          : "That mentorship offer has been withdrawn.",
      code: "forbidden",
    };
  }

  const employer = await repositories.organizations.find(actor, offer.businessId);
  if (!employer) {
    return { ok: false, error: "That employer is no longer in this market.", code: "not_found" };
  }
  const blocked = transactBlockReason(employer);
  if (blocked) {
    return { ok: false, error: blocked, code: "forbidden" };
  }

  const student = await repositories.students.find(actor, studentId);
  if (!student) {
    return { ok: false, error: "Student not found.", code: "not_found" };
  }
  if (student.marketId !== offer.marketId) {
    // Unreachable through the repositories, which scope both reads by market.
    // Stated anyway: this is the check that must not be the one nobody wrote.
    return { ok: false, error: "That student is in another market.", code: "forbidden" };
  }
  if (student.status !== "verified") {
    return {
      ok: false,
      // The college's verification is what says this person is enrolled and
      // who they claim to be. Mentorship has no supervisor, no timesheet and
      // no board interview behind it, so that check is the only one standing
      // between an adult and a student — it is not one to skip for the form
      // with the least machinery.
      error: "Verify this student before introducing them to a mentor.",
      code: "forbidden",
    };
  }

  const existing = await repositories.mentorshipPairings.forOffer(actor, offer.id);
  if (existing.some((p) => p.studentId === student.id && p.status === "introduced")) {
    return {
      ok: false,
      error: `${student.name} has already been introduced to this mentor.`,
      code: "duplicate",
    };
  }
  if (placesLeft(offer, existing) <= 0) {
    return {
      ok: false,
      error: `${offer.mentorName} is already mentoring ${offer.capacity} student${
        offer.capacity === 1 ? "" : "s"
      }. Wait for one of those to finish.`,
      code: "forbidden",
    };
  }

  const at = deps.now().toISOString();
  const pairing: MentorshipPairing = {
    id: deps.id("pair"),
    marketId: offer.marketId,
    offerId: offer.id,
    businessId: offer.businessId,
    studentId: student.id,
    introducedByUserId: actor.user.id,
    introducedOn: at,
    status: "introduced",
  };

  await deps.store.transaction((uow) => {
    uow.createMentorshipPairing(pairing);
    uow.appendAuditEvent({
      marketId: pairing.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "mentorship_pairing",
      entityId: pairing.id,
      from: null,
      to: "introduced",
      viaOverride: false,
    });
    for (const intent of notifications?.(pairing, offer) ?? []) {
      uow.enqueueNotification(intent);
    }
  });

  return { ok: true, created: pairing };
}

// ---------------------------------------------------------------------------
// Follow-up outcomes
// ---------------------------------------------------------------------------

export interface RecordOutcomeInput {
  studentId: string;
  /** Null when the learner was reached some way other than a placement. */
  applicationId: string | null;
  kind: OutcomeKind;
  /** Did the employer who supervised the placement take them on? */
  employedByHost?: boolean;
  /**
   * Where they went to work — county and two-letter state.
   *
   * Only meaningful on an employment outcome, and optional even there: a
   * follow-up that establishes somebody is working without establishing where
   * is a real and common half-answer, and refusing it would mean recording
   * nothing at all. It surfaces as `placeUnknown` in the summary rather than
   * being quietly scored as having left.
   */
  employmentCounty?: string;
  employmentState?: string;
  /** ISO date the outcome was true as of, not the day it is being entered. */
  observedOn: string;
  detail?: string;
}

/**
 * Record what a learner did next.
 *
 * A creation rather than a transition, and there is no update beside it: an
 * outcome is an observation, so a second follow-up six months later is a second
 * row. Nothing here can rewrite what an earlier one said, which is the point —
 * the history is the evidence a funder is being offered.
 */
export async function recordOutcome(
  actor: ActorContext,
  input: RecordOutcomeInput,
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<Outcome>> {
  if (!canRecordOutcome(actor.membership.role)) {
    return {
      ok: false,
      error: "Only the college or an administrator can record an outcome.",
      code: "forbidden",
    };
  }

  const student = await repositories.students.find(actor, input.studentId);
  if (!student) {
    return { ok: false, error: "Student not found.", code: "not_found" };
  }

  const at = deps.now();
  const observedOn = new Date(input.observedOn);
  if (Number.isNaN(observedOn.getTime())) {
    return { ok: false, error: "That is not a date.", code: "forbidden" };
  }
  if (observedOn.getTime() > at.getTime()) {
    // Nothing is observed before it happens. The schema refuses this too; it is
    // checked here so the caller gets a sentence rather than a constraint name.
    return {
      ok: false,
      error: "An outcome cannot be observed in the future.",
      code: "forbidden",
    };
  }

  let application = null;
  if (input.applicationId) {
    application = await repositories.applications.find(actor, input.applicationId);
    if (!application) {
      return { ok: false, error: "Placement not found.", code: "not_found" };
    }
    if (application.studentId !== student.id) {
      // Unreachable through the repositories, which scope both reads. Stated
      // anyway: an outcome filed against someone else's placement would
      // attribute one learner's job to another learner's experience.
      return {
        ok: false,
        error: "That placement belongs to a different learner.",
        code: "forbidden",
      };
    }
    const blocked = followUpBlockReason(application);
    if (blocked) return { ok: false, error: blocked, code: "forbidden" };
  }

  // Same-kind, same-date, same-experience is a double-submitted form rather
  // than a second follow-up. The unique index behind this says so too.
  const existing = await repositories.outcomes.forStudent(actor, student.id);
  const duplicate = existing.some(
    (o) =>
      o.applicationId === (input.applicationId ?? null) &&
      o.kind === input.kind &&
      o.observedOn === observedOn.toISOString(),
  );
  if (duplicate) {
    return {
      ok: false,
      error: `That outcome is already recorded for ${student.name} on this date.`,
      code: "duplicate",
    };
  }

  const detail = input.detail?.trim();
  /**
   * Where they went, normalised, and only where it means something.
   *
   * Trimmed and upper-cased on the state so that "ks" and " KS " are one
   * value — a comparison that is case-sensitive about a state code is a
   * retention figure that silently drops rows.
   */
  const place =
    input.kind === "employed" && input.employmentCounty && input.employmentState
      ? {
          county: input.employmentCounty.trim(),
          state: input.employmentState.trim().toUpperCase(),
        }
      : null;
  const outcome: Outcome = {
    id: deps.id("out"),
    marketId: student.marketId,
    studentId: student.id,
    applicationId: application?.id ?? null,
    kind: input.kind,
    // A place belongs to an employment outcome and to nothing else. Dropping it
    // here rather than refusing keeps a caller from having to know that rule,
    // and stops a stray county arriving on "still looking" and being counted.
    employedByHost: input.kind === "employed" ? (input.employedByHost ?? false) : false,
    employmentCounty: place?.county ?? null,
    employmentState: place?.state ?? null,
    // Null on everything written from here. `assertedInRegion` carries the
    // judgement from rows that predate the captured county, and nothing new
    // should ever be asserting what it can now derive.
    assertedInRegion: null,
    observedOn: observedOn.toISOString(),
    recordedOn: at.toISOString(),
    recordedByUserId: actor.user.id,
    // Frozen from the acting membership, never taken from the caller. A caller
    // who could name the source could file their own guess as a college's
    // finding.
    source: actor.membership.role,
    detail: detail ? detail : undefined,
  };

  await deps.store.transaction((uow) => {
    uow.createOutcome(outcome);
    uow.appendAuditEvent({
      marketId: outcome.marketId,
      at: outcome.recordedOn,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "outcome",
      entityId: outcome.id,
      from: null,
      to: outcome.kind,
      viaOverride: false,
    });
  });

  return { ok: true, created: outcome };
}

// ---------------------------------------------------------------------------
// What the host did
// ---------------------------------------------------------------------------

export interface RecordHostOfferInput {
  applicationId: string;
  answer: HostOfferAnswer;
  /** Why, when there was no offer. Never required — see `HostOffer.note`. */
  note?: string;
}

/**
 * Record what the employer did at the end of a placement.
 *
 * The cheapest high-value write in the product: one answer, from the only party
 * that knows it, on a screen it already visits. Everything else about the
 * record is derived here rather than accepted from the caller — the employer,
 * the learner, the market and the role all come from the placement and the
 * acting membership, so the request carries an application id and an answer and
 * nothing that could be used to file somebody else's decision.
 *
 * **An accepted offer also writes the outcome**, in the same transaction, and
 * that is the point of doing this at all. "Did you keep them?" is the strongest
 * result the programme produces and the employer answering it should not leave
 * a college to record the same fact again a month later. The employer never
 * touches a county — it has no standing to say where a learner it did not hire
 * went — but a hire by the host needs none: the county comes from the
 * employer's own registered county, which is a fact about the employer rather
 * than a claim about the learner.
 */
export async function recordHostOffer(
  actor: ActorContext,
  input: RecordHostOfferInput,
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<HostOffer>> {
  if (!canRecordHostOffer(actor.membership.role)) {
    return {
      ok: false,
      error: "Only the host employer or an administrator can answer this.",
      code: "forbidden",
    };
  }

  // Scoped read: an employer's application scope is its own postings, so a
  // placement it did not host resolves to null here rather than to a refusal.
  // That is the isolation, and the checks below are the second lock.
  const application = await repositories.applications.find(actor, input.applicationId);
  if (!application) {
    return { ok: false, error: "Placement not found.", code: "not_found" };
  }

  const blocked = offerBlockReason(application);
  if (blocked) return { ok: false, error: blocked, code: "forbidden" };

  const posting = await repositories.postings.find(actor, application.postingId);
  if (!posting) {
    return { ok: false, error: "Placement not found.", code: "not_found" };
  }
  if (
    actor.membership.role === "business" &&
    posting.businessId !== actor.membership.organizationId
  ) {
    // Unreachable through the scoped reads above. Stated anyway: an employer
    // answering for a placement it did not host would be filing a hiring
    // decision in another company's name.
    return {
      ok: false,
      error: "That placement was hosted by a different employer.",
      code: "forbidden",
    };
  }

  const already = await repositories.hostOffers.forApplication(actor, application.id);
  if (already) {
    return {
      ok: false,
      error: "This placement already has an answer.",
      code: "duplicate",
    };
  }

  const student = await repositories.students.find(actor, application.studentId);
  if (!student) {
    return { ok: false, error: "Learner not found.", code: "not_found" };
  }

  const at = deps.now();
  const note = input.note?.trim();
  const offer: HostOffer = {
    id: deps.id("hoff"),
    marketId: application.marketId,
    applicationId: application.id,
    businessId: posting.businessId,
    studentId: application.studentId,
    answer: input.answer,
    recordedByUserId: actor.user.id,
    recordedOn: at.toISOString(),
    // Frozen from the acting membership and never taken from the caller, for
    // the reason `Outcome.source` gives: a caller who could name the source
    // could file their own guess as an employer's firsthand answer.
    source: actor.membership.role,
    note: note ? note : undefined,
  };

  /**
   * The outcome a hire implies, written with the offer or not at all.
   *
   * Skipped when the college has already recorded a follow-up against this
   * placement on the same day for the same kind — that is the duplicate
   * `recordOutcome` refuses, and hitting it here would fail the whole
   * transaction and lose the employer's answer along with it. The answer is
   * the thing being asked for; the outcome is a convenience on top of it.
   */
  let outcome: Outcome | null = null;
  if (isHire(offer.answer)) {
    const existing = await repositories.outcomes.forApplication(actor, application.id);
    const observedOn = at.toISOString();
    const duplicate = existing.some(
      (o) => o.kind === "employed" && o.observedOn === observedOn,
    );
    if (!duplicate) {
      const organization = await repositories.organizations.find(
        actor,
        posting.businessId,
      );
      const market = await repositories.markets.find(actor, application.marketId);
      outcome = {
        id: deps.id("out"),
        marketId: application.marketId,
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed",
        employedByHost: true,
        // The employer's own county, not a guess about the learner. Null when
        // the organization has none recorded, which lands as `placeUnknown`
        // rather than as an invented place — `inRegion` answers true from
        // `employedByHost` either way, and the county is what lets the report
        // roll the hire up by county as well.
        employmentCounty: organization?.county ?? null,
        employmentState: organization?.county ? (market?.state ?? null) : null,
        assertedInRegion: null,
        observedOn,
        recordedOn: observedOn,
        recordedByUserId: actor.user.id,
        source: actor.membership.role,
      };
    }
  }

  await deps.store.transaction((uow) => {
    uow.createHostOffer(offer);
    uow.appendAuditEvent({
      marketId: offer.marketId,
      at: offer.recordedOn,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "host_offer",
      entityId: offer.id,
      from: null,
      to: offer.answer,
      viaOverride: false,
    });
    if (outcome) {
      uow.createOutcome(outcome);
      uow.appendAuditEvent({
        marketId: outcome.marketId,
        at: outcome.recordedOn,
        actorUserId: actor.user.id,
        actorRole: actor.membership.role,
        entityType: "outcome",
        entityId: outcome.id,
        from: null,
        to: outcome.kind,
        viaOverride: false,
      });
    }
  });

  return { ok: true, created: offer };
}

// ---------------------------------------------------------------------------
// Interview slots
// ---------------------------------------------------------------------------

/**
 * How far ahead a board may publish. Beyond a term nobody knows their calendar,
 * and a slot that exists for six months is a slot nobody will honour.
 */
export const MAX_SLOT_LEAD_DAYS = 120;

/** Sanity bounds on an eligibility interview, not a policy about its length. */
export const MIN_SLOT_MINUTES = 15;
export const MAX_SLOT_MINUTES = 120;

export interface SlotRequest {
  /** ISO instants, one per slot. Published together or not at all. */
  startsAt: string[];
  durationMinutes: number;
  officerName: string;
  meetingUrl: string | null;
}

/**
 * Publish interview slots.
 *
 * The board's own capability, and until now the button for it did nothing: a
 * board could only offer the times somebody had written into the fixtures,
 * which meant the eligibility interview — the step every subsidised placement
 * waits on — could not be scheduled by the people who run it.
 *
 * Published as a batch, because that is how the work actually happens. An
 * officer blocks out a morning, not one appointment; and doing it in one
 * transaction means a board never ends up with half a morning published and no
 * idea which half.
 *
 * The officer's name is on the slot rather than derived from the session,
 * deliberately: the person who publishes a calendar is routinely not the person
 * who sits the interviews, and a student turning up expecting one name and
 * meeting another is a bad first impression of a public agency.
 */
export async function publishInterviewSlots(
  actor: ActorContext,
  fields: SlotRequest,
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<InterviewSlot[]>> {
  if (actor.membership.role !== "board") {
    return {
      ok: false,
      error: "Only the workforce board publishes interview slots.",
      code: "forbidden",
    };
  }

  const { organizationId, marketId } = actor.membership;
  if (!organizationId || !marketId) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }

  const officerName = fields.officerName.trim();
  if (officerName.length < 2) {
    return { ok: false, error: "Say who is sitting these interviews.", code: "invalid" };
  }

  if (
    !Number.isInteger(fields.durationMinutes) ||
    fields.durationMinutes < MIN_SLOT_MINUTES ||
    fields.durationMinutes > MAX_SLOT_MINUTES
  ) {
    return {
      ok: false,
      error: `An interview runs between ${MIN_SLOT_MINUTES} and ${MAX_SLOT_MINUTES} minutes.`,
      code: "invalid",
    };
  }

  if (fields.startsAt.length === 0) {
    return { ok: false, error: "Pick at least one time.", code: "invalid" };
  }

  const now = deps.now();
  const horizon = now.getTime() + MAX_SLOT_LEAD_DAYS * 86_400_000;

  const times: string[] = [];
  for (const raw of fields.startsAt) {
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      return { ok: false, error: "One of those times is not a date.", code: "invalid" };
    }
    // A slot in the past is not a slot. Worth refusing rather than accepting
    // and hiding, because the board would see it published and nobody would
    // ever be offered it.
    if (at.getTime() <= now.getTime()) {
      return { ok: false, error: "Those times have already passed.", code: "invalid" };
    }
    if (at.getTime() > horizon) {
      return {
        ok: false,
        error: `Slots can be published up to ${MAX_SLOT_LEAD_DAYS} days ahead.`,
        code: "invalid",
      };
    }
    times.push(at.toISOString());
  }

  // Within the batch as well as against what is already published: an officer
  // double-booking themselves is the mistake a form makes easy.
  const existing = await repositories.interviewSlots.list(actor);
  const taken = new Set(
    existing
      .filter((slot) => slot.officerName === officerName)
      .map((slot) => slot.startsAt),
  );
  for (const at of times) {
    if (taken.has(at)) {
      return {
        ok: false,
        error: "One of those times is already published for that officer.",
        code: "invalid",
      };
    }
    taken.add(at);
  }

  const publishedAt = now.toISOString();
  const slots: InterviewSlot[] = times.map((startsAt) => ({
    id: deps.id("slot"),
    marketId,
    boardId: organizationId,
    startsAt,
    durationMinutes: fields.durationMinutes,
    officerName,
    bookedByStudentId: null,
    bookedAt: null,
    meetingUrl: fields.meetingUrl?.trim() || null,
    version: 1,
  }));

  await deps.store.transaction((uow) => {
    for (const slot of slots) {
      uow.createInterviewSlot(slot);
      uow.appendAuditEvent({
        marketId,
        at: publishedAt,
        actorUserId: actor.user.id,
        actorRole: actor.membership.role,
        entityType: "interview_slot",
        entityId: slot.id,
        from: null,
        to: "open",
        viaOverride: false,
      });
    }
  });

  return { ok: true, created: slots };
}
