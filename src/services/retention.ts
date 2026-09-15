/**
 * Carrying out the retention schedule.
 *
 * `domain/retention.ts` decides when a learner's identity is due to go and what
 * going means; this performs it. One operation, deliberately — there is no bulk
 * sweep and no scheduled job, and that is a decision rather than a gap.
 *
 * An automatic purge is the right end state and the wrong thing to ship first.
 * Anonymisation is irreversible, the clock depends on activity dates the
 * fixtures have only approximations of, and the first time it runs unattended
 * it will run against every record at once. A person pressing the button per
 * learner, against a list the console computes, is how you find out the
 * schedule is wrong while that is still cheap.
 */

import type { ActorContext, Student } from "@/domain/types";
import { purgeBlockReason, purgeStudent } from "@/domain/retention";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";

export type RetentionResult =
  | { ok: true; updated: Student }
  | { ok: false; error: string; code: "forbidden" | "not_found" };

export interface RetentionDeps {
  store: Store;
  now: () => Date;
}

const defaultDeps: RetentionDeps = { store, now: () => new Date() };

/**
 * Remove a learner's direct identifiers.
 *
 * The administrator alone, and not the college — which is the opposite of who
 * records consent, on purpose. Consent is the institution's own paperwork about
 * its own records; a purge is the platform discharging a statutory obligation
 * about data it holds, and it reaches records from every institution in the
 * market. It is also irreversible, which is reason enough to keep it on the one
 * desk that answers for the platform.
 */
export async function purgeLearnerIdentity(
  actor: ActorContext,
  studentId: string,
  reason: string,
  deps: RetentionDeps = defaultDeps,
): Promise<RetentionResult> {
  if (actor.membership.role !== "admin") {
    return {
      ok: false,
      error: "Only the program administrator can purge a learner's identity.",
      code: "forbidden",
    };
  }

  const student = await repositories.students.find(actor, studentId);
  if (!student) {
    return { ok: false, error: "Learner not found.", code: "not_found" };
  }

  const applications = await repositories.applications.forStudent(actor, student.id);
  const now = deps.now();
  const blocked = purgeBlockReason(student, applications, now);
  if (blocked) return { ok: false, error: blocked, code: "forbidden" };

  const note = reason.trim();
  if (!note) {
    return {
      ok: false,
      error: "Say why this record is being purged.",
      code: "forbidden",
    };
  }

  const purged = purgeStudent(student, now);

  await deps.store.transaction((uow) => {
    uow.purgeLearner(purged, purged.purgedOn!);
    uow.appendAuditEvent({
      marketId: student.marketId,
      at: purged.purgedOn!,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "student",
      entityId: student.id,
      from: "identified",
      to: "purged",
      reason: note,
      viaOverride: false,
    });
  });

  return { ok: true, updated: purged };
}
