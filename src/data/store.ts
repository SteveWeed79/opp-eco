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
  CreditAward,
  FundingCommitment,
  FundingSource,
  InterviewSlot,
  MentorshipOffer,
  MentorshipPairing,
  Organization,
  Outcome,
  Posting,
  Student,
  TimeEntry,
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
export interface NotificationQueue {
  /**
   * Claim everything pending. Claimed messages leave the queue, exactly as a
   * `splice` does, and come back only through `requeue`.
   */
  take(): Promise<QueuedNotification[]>;
  /** Return a message that failed for a reason a retry could fix. */
  requeue(item: QueuedNotification, error: string): Promise<void>;
  /** What is still waiting, for the administrator's outbox. */
  pending(marketId: string | null): Promise<NotificationIntent[]>;
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
  createOutcome(outcome: Outcome): void;
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
