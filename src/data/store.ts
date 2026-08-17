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
  InterviewSlot,
  MentorshipOffer,
  Organization,
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
  saveStudent(student: Student): void;
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
