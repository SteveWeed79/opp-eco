/**
 * The write side.
 *
 * Repositories read; a Store writes. They are separate because reads are
 * scoped per actor and can be served from anywhere, while writes must be
 * transactional and are the only place invariants can be broken.
 *
 * `transaction` is the contract that matters: a state change, its audit
 * record, and any notification it triggers either all land or none do. A
 * placement that advances without an audit entry is unauditable; a
 * notification sent for a change that rolled back is a lie.
 */

import type {
  Application,
  AuditEvent,
  ConsentRecord,
  CreditAward,
  Escalation,
  FundingCommitment,
  FundingSource,
  InterviewSlot,
  MentorshipOffer,
  MentorshipPairing,
  Membership,
  Organization,
  HostOffer,
  RegionDefinition,
  Outcome,
  Posting,
  Student,
  TimeEntry,
  User,
} from "@/domain/types";

/** A notification queued inside the transaction and dispatched after commit. */
export interface NotificationIntent {
  marketId: string;
  recipientUserId: string;
  /**
   * Address the organization's contact when the recipient has no user record.
   *
   * Most employers in a real market are a name and an email long before anyone
   * from that company has an account — the platform still has to be able to
   * tell them their candidate cleared. Resolution prefers the user; this is the
   * fallback, not a second recipient.
   */
  recipientOrganizationId?: string;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * A message that has been queued and not yet sent.
 *
 * `id` is the queue's own handle on the row, which the Postgres queue needs to
 * put a transient failure back and the in-memory queue has no use for. It is
 * deliberately opaque: nothing above the dispatcher reads it.
 */
export interface QueuedNotification {
  id: string | null;
  intent: NotificationIntent;
  /**
   * What was known about it when it was claimed.
   *
   * Carried through so a requeue can preserve the original queued time and
   * increment the attempt count. Absent on a queue that has nothing to carry.
   */
  waiting?: PendingNotification;
}

/**
 * The handoff between a committed transaction and the dispatcher.
 *
 * A seam rather than an array because the two data layers hold this queue in
 * different places: the fixtures in a module-level array, Postgres in the
 * `notification_outbox` table written inside the same transaction as the state
 * change. `outbox.ts` imported the array directly, which meant that on a
 * database deployment every message was written to the table and none was ever
 * sent — the dispatcher was draining a queue nothing filled.
 */
/**
 * A message that is still waiting, and what is known about why.
 *
 * `pending` used to return bare intents, which meant the only thing anybody
 * could say about the queue was how deep it is. Depth answers the wrong
 * question: a queue of thirty draining steadily is healthy and a queue of one
 * that has been there since Tuesday is not, and they look identical from a
 * count. The age is what an operator acts on, and the last error is what they
 * act on it with.
 */
export interface PendingNotification {
  intent: NotificationIntent;
  /** When it was queued, not when it was last tried. */
  queuedAt: string;
  /** Failed delivery attempts so far. Zero for something never tried. */
  attempts: number;
  /** Why the last attempt failed, when one has. */
  lastError: string | null;
}

export interface NotificationQueue {
  /**
   * Claim everything pending. Claimed messages leave the queue, exactly as a
   * `splice` does, and come back only through `requeue`.
   */
  take(): Promise<QueuedNotification[]>;
  /** Return a message that failed for a reason a retry could fix. */
  requeue(item: QueuedNotification, error: string): Promise<void>;
  /** What is still waiting, for the administrator's outbox and the health check. */
  pending(marketId: string | null): Promise<PendingNotification[]>;
}

/**
 * The mutations available inside a transaction. Deliberately narrow — anything
 * not listed here cannot be written, which keeps the write surface reviewable.
 */
export interface UnitOfWork {
  /**
   * Insert a new application.
   *
   * Separate from `saveApplication` rather than an upsert, because the two
   * have opposite preconditions: a save must find an existing row at a known
   * version, and a create must find none. Collapsing them would let a stale
   * version check silently become an insert.
   */
  createApplication(application: Application): void;
  /** Insert a new posting. Same reasoning as `createApplication`. */
  createPosting(posting: Posting): void;
  saveApplication(application: Application, expectedVersion: number): void;
  /**
   * Persist a student, and who verified them.
   *
   * `verifiedBy` is a second argument rather than a field on `Student` because
   * the domain type is what a screen renders and nobody renders it — but the
   * schema requires it: a student in `verified` without an attributable
   * verifier violates a CHECK constraint, so the acting user has to reach the
   * write. Null clears it, which is what a student leaving the verified state
   * needs; a stale verifier on a rejected record is the same auditor's finding
   * as a stale verification date.
   */
  saveStudent(student: Student, verifiedBy: string | null): void;
  /**
   * Record an introduction, and close one.
   *
   * A create rather than an upsert, for the reason `createApplication` is: the
   * same student may be introduced to the same mentor twice, months apart, and
   * an upsert would turn the second into an edit of the first.
   */
  createMentorshipPairing(pairing: MentorshipPairing): void;
  saveMentorshipPairing(pairing: MentorshipPairing): void;
  /**
   * Vetting and publication decisions.
   *
   * No version check on either, unlike applications and time entries: both are
   * single-desk workflows — an organization is vetted by one administrator, a
   * posting reviewed by one college — so the concurrent-write case these
   * protect against does not arise the way it does where five portals act on
   * one record. Add versions here the day a second desk appears.
   */
  saveOrganization(organization: Organization): void;
  savePosting(posting: Posting): void;
  /**
   * A standing offer of mentorship, and the employer's own availability
   * changes on it.
   *
   * Unversioned, on the same reasoning as postings and vetting: an offer has a
   * single desk. The employer who wrote it is the only party who can pause,
   * reopen, or withdraw it, so there is no second writer for a version check
   * to catch.
   */
  createMentorshipOffer(offer: MentorshipOffer): void;
  saveMentorshipOffer(offer: MentorshipOffer): void;
  /**
   * Publish a slot the board is offering.
   *
   * Separate from `saveInterviewSlot` for the same reason every other create
   * here is separate from its save: the preconditions are opposites. A save
   * must find a row at a known version; a create must find none, and collapsing
   * them would let a stale version check quietly become an insert.
   */
  createInterviewSlot(slot: InterviewSlot): void;
  saveInterviewSlot(slot: InterviewSlot, expectedVersion: number): void;
  /** Insert a week of logged hours. Same create/save split as applications. */
  createTimeEntry(entry: TimeEntry): void;
  saveTimeEntry(entry: TimeEntry, expectedVersion: number): void;
  saveCreditAward(award: CreditAward): void;
  /**
   * Record a follow-up observation.
   *
   * Create-only, and there is deliberately no `saveOutcome` beside it. An
   * outcome is an observation rather than a record that moves — a learner
   * followed up again six months later gets a second row, because the history
   * is the evidence and an update would destroy it.
   */
  /**
   * Open a fund, and change one.
   *
   * `saveFundingSource` is versioned, unlike vetting or a posting: an
   * allocation has more than one desk. A board officer adjusting an award and
   * an administrator correcting a figure is exactly the concurrent write the
   * version check exists for, and the loser overwriting a supplemental award
   * with a stale number is a funder-facing error.
   */
  createFundingSource(source: FundingSource): void;
  saveFundingSource(source: FundingSource, expectedVersion: number): void;
  /**
   * Draw against a fund, and give it back.
   *
   * Versioned for the same reason, and create-only-then-save rather than an
   * upsert: releasing a commitment must find one, and committing must not
   * silently overwrite an existing draw.
   */
  createFundingCommitment(commitment: FundingCommitment): void;
  saveFundingCommitment(commitment: FundingCommitment, expectedVersion: number): void;
  /**
   * Record a consent, and change one.
   *
   * Versioned, and withdrawal is a save rather than a delete: a learner
   * withdrawing is an event with a date that the institution which relied on
   * the consent may have to account for, and a deleted row cannot say what was
   * permitted when.
   */
  /**
   * Remove a learner's direct identifiers under the retention schedule.
   *
   * Its own operation rather than a flag on `saveStudent`, and narrow on
   * purpose: a learner's name and email live on `users` while the rest of the
   * record lives on `students`, so a purge is two writes that must not come
   * apart. Exposing a general `saveUser` to achieve it would hand every caller
   * the ability to rename a person, which nothing in this product should be
   * able to do.
   *
   * **It reaches the free text on observations too** — `outcomes.detail` and
   * `host_offers.note` — and that is four writes in one unit rather than two
   * for the same reason. The rule this schedule states is that the rows stay
   * and the identifiers go, and what survives is what aggregates are *by*.
   * Nothing aggregates over a sentence, and a sentence is the one field here
   * that can carry a name without anybody noticing: "no headcount, but she was
   * good" is an ordinary thing for an employer to write and a direct identifier
   * sitting beside a record whose identity has been scrubbed.
   *
   * The kind, the county and the answer are left alone. They are the figures
   * the purge exists to preserve, and none of them names anybody.
   */
  purgeLearner(student: Student, at: string): void;
  /**
   * Change the work address an account is known by. Nothing else about them.
   *
   * Narrow for the same reason `purgeLearner` is: a general `saveUser` would
   * hand every caller the ability to rename a person. This one can move an
   * address and cannot touch a name, so what it is for is readable from what it
   * can do.
   *
   * It is the account-recovery path for somebody whose mailbox is gone — a
   * public employee whose agency address changed, with no password to fall back
   * on and no identity provider to ask. That makes it the most dangerous write
   * in this file: the address is the credential on the code path and the reset
   * route on the password path, so moving it is the act of handing an account
   * to whoever holds the new mailbox. `changeWorkAddress` is the only caller,
   * and it is where the reason, the domain check and the audit entry live.
   */
  changeUserEmail(userId: string, email: string): void;
  /**
   * Give an organization another person, with their own account.
   *
   * One operation rather than two, for the reason `purgeLearner` is one: a user
   * with no membership cannot sign in and cannot be scoped, and a membership
   * with no user is a dangling reference. Half of this landing is a row nobody
   * can use and nobody can see.
   *
   * **One account is one person.** That is the whole of how attribution works
   * here — a board officer's eligibility determination is attributable because
   * `actorUserId` names them, and it stops being attributable the moment an
   * office shares a login. Nothing in the schema can enforce that; an address
   * is an address. So it is a rule this operation exists to make easy to
   * follow: adding a colleague is adding an account, never sharing one.
   */
  addOrganizationMember(user: User, membership: Membership): void;
  createConsent(consent: ConsentRecord): void;
  saveConsent(consent: ConsentRecord, expectedVersion: number): void;
  createOutcome(outcome: Outcome): void;
  /**
   * Record what the host did at the end of a placement.
   *
   * Create-only like `createOutcome`, but for the opposite reason. An outcome
   * is create-only because a second follow-up is a second observation and the
   * history is the evidence. This is create-only because there is exactly one
   * answer per placement — the unique index says so — and an employer changing
   * its mind is rare enough to be an administrator's job rather than a write
   * path anybody can reach.
   */
  createHostOffer(offer: HostOffer): void;
  /**
   * Record a new boundary for a market.
   *
   * Create-only, and there is deliberately no `saveRegionDefinition`. Every
   * other create-only operation here is that way because the record is an
   * observation; this one is that way because **editing a boundary rewrites
   * every figure ever computed against it**. A redesignation is a new row with
   * a later effective date, and the row it supersedes is left untouched.
   */
  createRegionDefinition(definition: RegionDefinition): void;
  createEscalation(escalation: Escalation): void;
  /**
   * Pick one up, close it, or withdraw it.
   *
   * Unlike most `save*` here, the kind and the summary are not in the SET list
   * on the Postgres side: they are what somebody reported, and an escalation
   * edited into being about something else is worse than none at all.
   */
  saveEscalation(escalation: Escalation, expectedVersion: number): void;
  appendAuditEvent(event: Omit<AuditEvent, "id">): void;
  enqueueNotification(intent: NotificationIntent): void;
}

export interface Store {
  transaction<T>(work: (uow: UnitOfWork) => T): Promise<T>;
}

/**
 * Raised when a record changed underneath the caller.
 *
 * Two people acting on one application is routine here — a business declining
 * while a student withdraws, a board authorizing while an admin overrides, two
 * students racing for the last interview slot. The loser must be told to look
 * again, never silently overwritten.
 */
export class ConcurrencyError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(
      `${entity} ${id} was changed by someone else. Reload and try again.`,
    );
    this.name = "ConcurrencyError";
  }
}
