/**
 * A learner registers themselves.
 *
 * The write side of `domain/registration.ts`, and the first way into this
 * system that is not an administrator adding somebody by hand. Phase 1 of the
 * user story has always opened with "students self-activate once their market
 * is live"; until now the college's verification queue could only ever be
 * filled by the seed.
 *
 * **This is `addOrganizationMember`'s public cousin, and the difference that
 * matters is enumeration.** That function tells a caller plainly that "somebody
 * already has that address", and says in a comment why that is safe: it is an
 * administrator looking at their own organization's people. Here the caller is
 * a stranger, and the same sentence turns the form into an oracle for which
 * addresses hold accounts. So a duplicate is answered **exactly** as a success
 * is — same shape, same wording — and writes nothing.
 *
 * What that costs is real and worth stating: somebody who genuinely forgot they
 * had registered gets told to check their email and finds nothing. The remedy
 * is the one every account here already uses — request a password on the
 * sign-in page — and it works whether or not they remember. The alternative
 * hands an attacker a roster.
 *
 * No credential is issued. Every account in this system gets its password by
 * asking for a code at the address it was registered with, and a second path
 * for new learners would be a second way to become somebody.
 */

import type { Membership, Student, User } from "@/domain/types";
import {
  marketAcceptsRegistrations,
  registrationBlockReason,
  type RegistrableCollege,
} from "@/domain/registration";
import { addressMatchesOrganization, normaliseEmail } from "@/domain/identity";
import { repositories, store } from "@/data/backend";
import { authStore } from "@/auth/backend";
import { systemContext } from "@/auth/system";
import type { Store } from "@/data/store";
import { logger } from "./logging";

export type RegistrationResult =
  | { ok: true }
  | { ok: false; error: string };

export interface RegistrationDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: RegistrationDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

/**
 * The colleges a stranger may choose between.
 *
 * Read through `systemContext`, which is the named seam for a read that belongs
 * to nobody — the same one that resolves an address to a sign-in method before
 * anybody is authenticated. Narrowed to three fields on the way out, because
 * this renders on a page anyone can load and an `Organization` carries a
 * contact address, a vetting status and an identity mode a stranger has no
 * business reading.
 */
export async function registrableColleges(): Promise<RegistrableCollege[]> {
  const actor = systemContext();
  const markets = await repositories.markets.list(actor);
  const open = markets.filter(marketAcceptsRegistrations);
  if (open.length === 0) return [];

  const colleges = await repositories.organizations.list(actor, { kind: "college" });
  const byMarket = new Map(open.map((m) => [m.id, m]));

  return colleges
    .filter((college) => college.marketId && byMarket.has(college.marketId))
    .map((college) => ({
      id: college.id,
      name: college.name,
      marketName: byMarket.get(college.marketId!)!.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface RegisterLearnerInput {
  name: string;
  email: string;
  collegeId: string;
}

/**
 * Create a learner, their account, and their membership — unverified.
 *
 * `registered` is the status, and the college decides what happens next. That
 * is the whole point: this fills the queue rather than bypassing it.
 */
export async function registerLearner(
  input: RegisterLearnerInput,
  deps: RegistrationDeps = defaultDeps,
): Promise<RegistrationResult> {
  const actor = systemContext();
  const address = normaliseEmail(input.email);

  const college = await repositories.organizations.find(actor, input.collegeId);
  const market = college?.marketId
    ? await repositories.markets.find(actor, college.marketId)
    : null;

  const refusal = registrationBlockReason({
    name: input.name,
    college,
    market,
    addressMatchesCollege: Boolean(
      college && address.includes("@") && addressMatchesOrganization(address, college),
    ),
  });
  if (refusal) return { ok: false, error: refusal };

  // Everything below this line answers identically whether or not the address
  // is already taken — see the note at the top of this file.
  if (await authStore().findUserByEmail(address)) {
    logger.info("registration.duplicate", { collegeId: college!.id });
    return { ok: true };
  }

  const user: User = { id: deps.id("u"), name: input.name.trim(), email: address };
  const membership: Membership = {
    id: deps.id("mem"),
    userId: user.id,
    // A learner belongs to their college the same way a board officer belongs
    // to their board: the membership is what `actorForPortal` resolves and what
    // every repository read is scoped by.
    organizationId: college!.id,
    marketId: market!.id,
    // Derived from what this function is, never accepted from the form. The
    // reasoning `addOrganizationMember` gives applies with more force here,
    // because the caller is a stranger.
    role: "student",
  };
  const student: Student = {
    id: deps.id("stu"),
    marketId: market!.id,
    userId: user.id,
    collegeId: college!.id,
    name: user.name,
    email: address,
    // Empty rather than absent. The master profile is the learner's next step
    // and the college's verification queue shows them as incomplete, which is
    // the honest state — not a profile pretending to exist.
    programOfStudy: "",
    classStanding: "",
    expectedGraduation: "",
    skills: [],
    interests: [],
    availableHoursPerWeek: 0,
    status: "registered",
    eligibility: "not_determined",
    eligibilityDeterminedOn: null,
    eligibilityExpiresOn: null,
    verifiedOn: null,
    purgedOn: null,
  };

  await deps.store.transaction((uow) => {
    uow.addOrganizationMember(user, membership);
    uow.createStudent(student);
    uow.appendAuditEvent({
      marketId: market!.id,
      at: deps.now().toISOString(),
      actorUserId: user.id,
      actorRole: "student",
      entityType: "student",
      entityId: student.id,
      from: null,
      // Named rather than "student created", because the question asked of this
      // row later is which college a learner claimed and when.
      to: `registered with ${college!.name}`,
      viaOverride: false,
    });
    uow.enqueueNotification({
      marketId: market!.id,
      recipientUserId: user.id,
      kind: "student.registered",
      payload: { collegeName: college!.name },
    });
  });

  logger.info("registration.accepted", {
    studentId: student.id,
    collegeId: college!.id,
  });
  return { ok: true };
}

/** Exposed for the page, which renders nothing when no market is open. */
export type { RegistrableCollege };
