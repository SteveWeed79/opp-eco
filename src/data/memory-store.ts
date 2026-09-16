/**
 * In-memory Store.
 *
 * Writes land in the seeded arrays, so the demo actually moves when you click
 * and resets when the process restarts — which is the right behaviour for a
 * demo nobody wants to curate by hand after every walkthrough.
 *
 * A Postgres implementation satisfies the same interface: `transaction` maps
 * to BEGIN/COMMIT, and the version checks below become `WHERE version = $n`
 * with a rowcount assertion.
 */

import type { AuditEvent } from "@/domain/types";
import { withoutParticipantPII } from "@/services/notification-privacy";
import * as seed from "./seed";
import { addMembership } from "./session";
import {
  ConcurrencyError,
  type NotificationIntent,
  type NotificationQueue,
  type QueuedNotification,
  type Store,
  type PendingNotification,
  type UnitOfWork,
} from "./store";

let auditSequence = 1000;

/**
 * Notifications queued by committed transactions, awaiting dispatch.
 *
 * Held rather than sent inline because a send that fails after the state
 * change has committed must be retryable, and a send that succeeds before a
 * rollback has told someone about work that did not happen.
 */
export const pendingNotifications: PendingNotification[] = [];

/** Injected so a test can queue a message and then age it. */
export let queueClock: () => Date = () => new Date();

export function setQueueClock(next: () => Date) {
  queueClock = next;
}

/**
 * The array above, behind the queue contract.
 *
 * No ids: an in-memory queue has nothing to address a row by, and the
 * dispatcher never needs one because `requeue` simply pushes the intent back.
 */
export const memoryNotificationQueue: NotificationQueue = {
  async take() {
    return pendingNotifications
      .splice(0, pendingNotifications.length)
      .map((waiting) => ({ id: null, intent: waiting.intent, waiting }));
  },
  async requeue(item: QueuedNotification, error: string) {
    // The original queued time survives a retry, deliberately. Resetting it
    // would make a message that has failed for three days look like one that
    // arrived a minute ago, which is exactly the message an operator most needs
    // to see.
    const previous = (item as { waiting?: PendingNotification }).waiting;
    pendingNotifications.push({
      intent: item.intent,
      queuedAt: previous?.queuedAt ?? queueClock().toISOString(),
      attempts: (previous?.attempts ?? 0) + 1,
      lastError: error,
    });
  },
  async pending(marketId: string | null) {
    return marketId
      ? pendingNotifications.filter((n) => n.intent.marketId === marketId)
      : [...pendingNotifications];
  },
};

class MemoryUnitOfWork implements UnitOfWork {
  /** Staged so nothing is visible until the whole unit succeeds. */
  private readonly effects: (() => void)[] = [];

  createApplication(application: import("@/domain/types").Application) {
    // Refuses rather than upserts. A create that quietly overwrote an existing
    // row would turn a duplicate submission into silent data loss.
    if (seed.applications.some((a) => a.id === application.id)) {
      throw new Error(`Application ${application.id} already exists`);
    }
    this.effects.push(() => {
      seed.applications.push(application);
    });
  }

  createPosting(posting: import("@/domain/types").Posting) {
    if (seed.postings.some((p) => p.id === posting.id)) {
      throw new Error(`Posting ${posting.id} already exists`);
    }
    this.effects.push(() => {
      seed.postings.push(posting);
    });
  }

  saveApplication(application: import("@/domain/types").Application, expectedVersion: number) {
    const index = seed.applications.findIndex((a) => a.id === application.id);
    if (index === -1) throw new Error(`Unknown application ${application.id}`);
    if (seed.applications[index].version !== expectedVersion) {
      throw new ConcurrencyError("Application", application.id);
    }
    this.effects.push(() => {
      seed.applications[index] = { ...application, version: expectedVersion + 1 };
    });
  }

  /**
   * `verifiedBy` is accepted and dropped: the fixtures store a `Student`, which
   * has no field for it. Taking the argument anyway keeps one contract for both
   * stores, so the Postgres path cannot be the only one a call site remembers
   * to satisfy.
   */
  saveStudent(
    student: import("@/domain/types").Student,
    verifiedBy: string | null,
  ) {
    void verifiedBy;
    const index = seed.students.findIndex((s) => s.id === student.id);
    if (index === -1) throw new Error(`Unknown student ${student.id}`);
    this.effects.push(() => {
      seed.students[index] = student;
    });
  }

  createMentorshipPairing(pairing: import("@/domain/types").MentorshipPairing) {
    if (seed.mentorshipPairings.some((p) => p.id === pairing.id)) {
      throw new Error(`Mentorship pairing ${pairing.id} already exists`);
    }
    this.effects.push(() => {
      seed.mentorshipPairings.push(pairing);
    });
  }

  saveMentorshipPairing(pairing: import("@/domain/types").MentorshipPairing) {
    const index = seed.mentorshipPairings.findIndex((p) => p.id === pairing.id);
    if (index === -1) throw new Error(`Unknown mentorship pairing ${pairing.id}`);
    this.effects.push(() => {
      seed.mentorshipPairings[index] = pairing;
    });
  }

  saveOrganization(organization: import("@/domain/types").Organization) {
    const index = seed.organizations.findIndex((o) => o.id === organization.id);
    if (index === -1) throw new Error(`Unknown organization ${organization.id}`);
    this.effects.push(() => {
      seed.organizations[index] = organization;
    });
  }

  savePosting(posting: import("@/domain/types").Posting) {
    const index = seed.postings.findIndex((p) => p.id === posting.id);
    if (index === -1) throw new Error(`Unknown posting ${posting.id}`);
    this.effects.push(() => {
      seed.postings[index] = posting;
    });
  }

  createMentorshipOffer(offer: import("@/domain/types").MentorshipOffer) {
    if (seed.mentorshipOffers.some((o) => o.id === offer.id)) {
      throw new Error(`Mentorship offer ${offer.id} already exists`);
    }
    this.effects.push(() => {
      seed.mentorshipOffers.push(offer);
    });
  }

  saveMentorshipOffer(offer: import("@/domain/types").MentorshipOffer) {
    const index = seed.mentorshipOffers.findIndex((o) => o.id === offer.id);
    if (index === -1) throw new Error(`Unknown mentorship offer ${offer.id}`);
    this.effects.push(() => {
      seed.mentorshipOffers[index] = offer;
    });
  }


  createInterviewSlot(slot: import("@/domain/types").InterviewSlot) {
    if (seed.publishedSlots.some((existing) => existing.id === slot.id)) {
      throw new Error(`Interview slot ${slot.id} already exists`);
    }
    this.effects.push(() => {
      seed.publishedSlots.push(slot);
    });
  }
  saveInterviewSlot(slot: import("@/domain/types").InterviewSlot, expectedVersion: number) {
    const current = seed.slotOverrides.get(slot.id);
    const version = current?.version ?? 1;
    if (version !== expectedVersion) {
      throw new ConcurrencyError("Interview slot", slot.id);
    }
    this.effects.push(() => {
      seed.slotOverrides.set(slot.id, { ...slot, version: expectedVersion + 1 });
    });
  }

  createTimeEntry(entry: import("@/domain/types").TimeEntry) {
    if (seed.timeEntries.some((e) => e.id === entry.id)) {
      throw new Error(`Time entry ${entry.id} already exists`);
    }
    this.effects.push(() => {
      seed.timeEntries.push(entry);
    });
  }

  saveTimeEntry(entry: import("@/domain/types").TimeEntry, expectedVersion: number) {
    const index = seed.timeEntries.findIndex((e) => e.id === entry.id);
    if (index === -1) throw new Error(`Unknown time entry ${entry.id}`);
    if (seed.timeEntries[index].version !== expectedVersion) {
      // Two supervisors clearing the same queue is exactly as routine as two
      // students racing for an interview slot.
      throw new ConcurrencyError("Time entry", entry.id);
    }
    this.effects.push(() => {
      seed.timeEntries[index] = { ...entry, version: expectedVersion + 1 };
    });
  }

  saveCreditAward(award: import("@/domain/types").CreditAward) {
    const index = seed.creditAwards.findIndex((c) => c.id === award.id);
    this.effects.push(() => {
      if (index === -1) seed.creditAwards.push(award);
      else seed.creditAwards[index] = award;
    });
  }

  createFundingSource(source: import("@/domain/types").FundingSource) {
    if (seed.fundingSources.some((f) => f.id === source.id)) {
      throw new Error(`Funding source ${source.id} already exists`);
    }
    this.effects.push(() => {
      seed.fundingSources.push(source);
    });
  }

  saveFundingSource(
    source: import("@/domain/types").FundingSource,
    expectedVersion: number,
  ) {
    const index = seed.fundingSources.findIndex((f) => f.id === source.id);
    if (index === -1) throw new Error(`Unknown funding source ${source.id}`);
    if (seed.fundingSources[index].version !== expectedVersion) {
      // A board officer and an administrator adjusting one allocation is the
      // likeliest conflict here, and the loser must not overwrite a
      // supplemental award with a stale figure.
      throw new ConcurrencyError("Funding source", source.id);
    }
    this.effects.push(() => {
      seed.fundingSources[index] = { ...source, version: expectedVersion + 1 };
    });
  }

  createFundingCommitment(commitment: import("@/domain/types").FundingCommitment) {
    if (seed.fundingCommitments.some((c) => c.id === commitment.id)) {
      throw new Error(`Funding commitment ${commitment.id} already exists`);
    }
    this.effects.push(() => {
      seed.fundingCommitments.push(commitment);
    });
  }

  saveFundingCommitment(
    commitment: import("@/domain/types").FundingCommitment,
    expectedVersion: number,
  ) {
    const index = seed.fundingCommitments.findIndex((c) => c.id === commitment.id);
    if (index === -1) throw new Error(`Unknown funding commitment ${commitment.id}`);
    if (seed.fundingCommitments[index].version !== expectedVersion) {
      throw new ConcurrencyError("Funding commitment", commitment.id);
    }
    this.effects.push(() => {
      seed.fundingCommitments[index] = { ...commitment, version: expectedVersion + 1 };
    });
  }

  purgeLearner(student: import("@/domain/types").Student, at: string) {
    const index = seed.students.findIndex((s) => s.id === student.id);
    if (index === -1) throw new Error(`Unknown student ${student.id}`);
    const userIndex = seed.users.findIndex((u) => u.id === student.userId);
    this.effects.push(() => {
      seed.students[index] = { ...student, purgedOn: at };
      // The identity lives on the user record, so the purge has to reach it.
      // Both writes land in the same staged unit: a learner whose student row
      // says purged while their user row still carries an email is the exact
      // state this is meant to make impossible.
      if (userIndex !== -1) {
        seed.users[userIndex] = {
          ...seed.users[userIndex],
          name: student.name,
          email: student.email,
        };
      }
      // And the free text, for the reason the contract gives: a sentence is
      // the one field here that can carry a name without anybody noticing.
      // Rewritten in place rather than filtered out — the observation itself is
      // what the figures are computed from and has to survive.
      for (let i = 0; i < seed.outcomes.length; i++) {
        if (seed.outcomes[i].studentId === student.id && seed.outcomes[i].detail) {
          seed.outcomes[i] = { ...seed.outcomes[i], detail: undefined };
        }
      }
      for (let i = 0; i < seed.hostOffers.length; i++) {
        if (seed.hostOffers[i].studentId === student.id && seed.hostOffers[i].note) {
          seed.hostOffers[i] = { ...seed.hostOffers[i], note: undefined };
        }
      }
    });
  }

  changeUserEmail(userId: string, email: string) {
    const index = seed.users.findIndex((u) => u.id === userId);
    if (index === -1) throw new Error(`Unknown user ${userId}`);
    this.effects.push(() => {
      seed.users[index] = { ...seed.users[index], email };
    });
  }

  addOrganizationMember(
    user: import("@/domain/types").User,
    membership: import("@/domain/types").Membership,
  ) {
    if (seed.users.some((u) => u.id === user.id)) {
      throw new Error(`User ${user.id} already exists`);
    }
    // `users.email` is unique and case-insensitive in Postgres, so refusing
    // here too keeps the two layers answering the same question. Without it the
    // fixtures would happily hold two people on one address — the exact state
    // that makes an audit entry stop naming anybody.
    const address = user.email.trim().toLowerCase();
    if (seed.users.some((u) => u.email.trim().toLowerCase() === address)) {
      throw new Error(`Address ${user.email} already belongs to somebody`);
    }
    this.effects.push(() => {
      seed.users.push(user);
      addMembership(membership);
    });
  }

  createConsent(consent: import("@/domain/types").ConsentRecord) {
    if (seed.consents.some((c) => c.id === consent.id)) {
      throw new Error(`Consent ${consent.id} already exists`);
    }
    this.effects.push(() => {
      seed.consents.push(consent);
    });
  }

  saveConsent(
    consent: import("@/domain/types").ConsentRecord,
    expectedVersion: number,
  ) {
    const index = seed.consents.findIndex((c) => c.id === consent.id);
    if (index === -1) throw new Error(`Unknown consent ${consent.id}`);
    if (seed.consents[index].version !== expectedVersion) {
      throw new ConcurrencyError("Consent", consent.id);
    }
    this.effects.push(() => {
      seed.consents[index] = { ...consent, version: expectedVersion + 1 };
    });
  }

  createOutcome(outcome: import("@/domain/types").Outcome) {
    if (seed.outcomes.some((o) => o.id === outcome.id)) {
      throw new Error(`Outcome ${outcome.id} already exists`);
    }
    this.effects.push(() => {
      seed.outcomes.push(outcome);
    });
  }

  createHostOffer(offer: import("@/domain/types").HostOffer) {
    if (seed.hostOffers.some((o) => o.id === offer.id)) {
      throw new Error(`Host offer ${offer.id} already exists`);
    }
    // The uniqueness that matters is one answer per placement, which is the
    // constraint Postgres carries. Checked here too, or the two backends
    // disagree about whether a second answer is an error or a silent duplicate
    // — and the in-memory one is what the whole demo and e2e suite run on.
    if (seed.hostOffers.some((o) => o.applicationId === offer.applicationId)) {
      throw new Error(`Placement ${offer.applicationId} already has an answer`);
    }
    this.effects.push(() => {
      seed.hostOffers.push(offer);
    });
  }

  appendAuditEvent(event: Omit<AuditEvent, "id">) {
    this.effects.push(() => {
      seed.auditEvents.unshift({ ...event, id: `evt-${++auditSequence}` });
    });
  }

  /**
   * Queued with participant PII stripped.
   *
   * The templates name a record rather than a person, so in practice there is
   * nothing to strip. This is the backstop, and it sits here — at the
   * `UnitOfWork`, which every write passes through — rather than at the
   * renderer, because the Postgres queue persists the payload to a table. A
   * guard at render time would leave the PII sitting in `notification_outbox`.
   */
  enqueueNotification(intent: NotificationIntent) {
    const safe = withoutParticipantPII(intent);
    this.effects.push(() => {
      pendingNotifications.push({
        intent: safe,
        queuedAt: queueClock().toISOString(),
        attempts: 0,
        lastError: null,
      });
    });
  }

  /** Apply every staged effect. Called only after the work function returns. */
  commit() {
    for (const effect of this.effects) effect();
  }
}

export const memoryStore: Store = {
  async transaction<T>(work: (uow: UnitOfWork) => T): Promise<T> {
    const uow = new MemoryUnitOfWork();
    // Validation (including version checks) runs during `work`; nothing is
    // visible to a reader until commit, so a throw leaves state untouched.
    const result = work(uow);
    uow.commit();
    return result;
  },
};
