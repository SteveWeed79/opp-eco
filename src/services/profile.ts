/**
 * What a learner may change about themselves, and what they may not.
 *
 * The line is not arbitrary. A learner's **name, email and college** are what
 * the institution verified — `verifiedOn` means a registrar confirmed this
 * person is enrolled there — and letting the record edit itself would make that
 * verification meaningless. The email is also the credential under real
 * sign-on, so self-service editing of it is an account-takeover primitive
 * rather than a profile feature.
 *
 * What is left is everything a match is actually made on: what they study, how
 * far along they are, what they can do, what they want to do, and how many
 * hours a week they have. All of that is the learner's own claim about
 * themselves, it changes every term, and nobody else is in a position to keep
 * it current.
 *
 * Eligibility and status are absent for the same reason as the name: they are
 * determinations somebody else made.
 */

import type { ActorContext, Student } from "@/domain/types";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";

/** The fields a learner owns. Anything not listed here is somebody else's. */
export interface ProfileEdit {
  programOfStudy: string;
  classStanding: string;
  expectedGraduation: string;
  skills: string[];
  interests: string[];
  availableHoursPerWeek: number;
}

export type ProfileResult =
  | { ok: true; updated: Student }
  | { ok: false; error: string };

export interface ProfileDeps {
  store: Store;
  now: () => Date;
}

const defaultDeps: ProfileDeps = { store, now: () => new Date() };

export const MAX_HOURS_PER_WEEK = 40;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;

/** Trim, drop blanks, de-duplicate case-insensitively, and cap the list. */
function cleanTags(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = value.trim();
    if (!tag || tag.length > MAX_TAG_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * Update a learner's own profile.
 *
 * The learner alone. Not the college — which can verify a record and record a
 * consent about it, but should not be able to rewrite what somebody says they
 * are interested in — and not an administrator, for the same reason. If a
 * registrar needs to correct a programme of study, that is a different
 * operation with a different audit trail, and it does not exist yet.
 */
export async function updateProfile(
  actor: ActorContext,
  edit: ProfileEdit,
  deps: ProfileDeps = defaultDeps,
): Promise<ProfileResult> {
  if (actor.membership.role !== "student") {
    return { ok: false, error: "Only a learner can edit their own profile." };
  }

  const student = await repositories.students.forUser(actor, actor.user.id);
  if (!student) return { ok: false, error: "No learner record for this account." };

  if (student.purgedOn) {
    // Nothing to edit: the identifiers are gone and the record is kept only so
    // the programme's own figures still reconcile.
    return { ok: false, error: "This record has been purged." };
  }

  const programOfStudy = edit.programOfStudy.trim();
  if (programOfStudy.length < 2) {
    return { ok: false, error: "What are you studying?" };
  }

  const classStanding = edit.classStanding.trim();
  if (!classStanding) return { ok: false, error: "How far along are you?" };

  const hours = Number(edit.availableHoursPerWeek);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS_PER_WEEK) {
    return {
      ok: false,
      error: `Available hours run from 1 to ${MAX_HOURS_PER_WEEK} a week.`,
    };
  }

  const expectedGraduation = edit.expectedGraduation.trim();
  if (!expectedGraduation) {
    return { ok: false, error: "When do you expect to finish?" };
  }

  const updated: Student = {
    ...student,
    programOfStudy,
    classStanding,
    expectedGraduation,
    skills: cleanTags(edit.skills),
    interests: cleanTags(edit.interests),
    availableHoursPerWeek: hours,
  };

  const at = deps.now().toISOString();

  await deps.store.transaction((uow) => {
    // `null` for `verifiedBy`: this edit is not a verification and must not be
    // mistaken for one. The college's confirmation stands on the fields the
    // college confirmed, none of which are writable here.
    uow.saveStudent(updated, null);
    uow.appendAuditEvent({
      marketId: student.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "student",
      entityId: student.id,
      from: "profile",
      to: "profile_updated",
      viaOverride: false,
    });
  });

  return { ok: true, updated };
}
