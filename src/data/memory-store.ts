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
import * as seed from "./seed";
import {
  ConcurrencyError,
  type NotificationIntent,
  type Store,
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
export const pendingNotifications: NotificationIntent[] = [];

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

  saveStudent(student: import("@/domain/types").Student) {
    const index = seed.students.findIndex((s) => s.id === student.id);
    if (index === -1) throw new Error(`Unknown student ${student.id}`);
    this.effects.push(() => {
      seed.students[index] = student;
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

  saveCreditAward(award: import("@/domain/types").CreditAward) {
    const index = seed.creditAwards.findIndex((c) => c.id === award.id);
    this.effects.push(() => {
      if (index === -1) seed.creditAwards.push(award);
      else seed.creditAwards[index] = award;
    });
  }

  appendAuditEvent(event: Omit<AuditEvent, "id">) {
    this.effects.push(() => {
      seed.auditEvents.unshift({ ...event, id: `evt-${++auditSequence}` });
    });
  }

  enqueueNotification(intent: NotificationIntent) {
    this.effects.push(() => {
      pendingNotifications.push(intent);
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
