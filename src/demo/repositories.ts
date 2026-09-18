/**
 * The visitor's own actions, rendered as if they had happened.
 *
 * A decorator over whichever `Repositories` implementation is live, not a third
 * implementation. `Repositories` is already the seam `backend.ts` swaps between
 * memory and Postgres, so an overlay belongs at the same seam — and putting it
 * here rather than at the call sites is what keeps the promise that the
 * demonstration is the product rather than a copy of it:
 *
 *  - **No page changes.** Not one of the 8,525 lines under `/demo`.
 *  - **Neither data layer changes.** The parity suite still proves memory and
 *    Postgres indistinguishable, because neither has heard of this.
 *  - **New work flows through untouched.** A portal page added next month
 *    passes through a decorator that knows nothing about it, and nothing is
 *    wired twice.
 *
 * Everything not listed here passes straight through. That is the point: the
 * overlay covers what a visitor can actually do, and the rest of the system
 * behaves exactly as it does for a signed-in person.
 */

import { scoreMatch } from "@/domain/matching";
import type { Application, ActorContext } from "@/domain/types";
import type { Repositories } from "@/data/repositories";
import { isDemonstrationVisitor } from "@/auth/visitor";
import { readOverlay } from "./overlay";

/**
 * An application the visitor's click implies, derived rather than stored.
 *
 * Every field comes from rows the server already holds — the posting, the
 * learner, and the same `scoreMatch` the real service uses — so a derived
 * application and a submitted one differ in exactly one way: this one is gone
 * when the cookie is.
 *
 * `submitApplication` is the shape being matched. It is not called, because
 * calling it would write.
 */
function derive(
  posting: { id: string; marketId: string; track: Application["track"] },
  studentId: string,
  matchScore: Application["matchScore"],
  at: string,
): Application {
  return {
    // Marked in the id rather than only in the cookie, so a row that somehow
    // reached a log or a screen announces where it came from.
    id: `app-demo-${posting.id}`,
    marketId: posting.marketId,
    postingId: posting.id,
    studentId,
    track: posting.track,
    status: "submitted",
    furthestStatus: "submitted",
    submittedOn: at,
    statusSince: at,
    matchScore,
    version: 1,
  };
}

/** The visitor's derived applications, or none. */
async function derivedFor(
  base: Repositories,
  actor: ActorContext,
): Promise<Application[]> {
  // Checked before the cookie is read, and safe everywhere: with `AUTH_MODE`
  // unset this is false without touching a cookie, so the unit suite never
  // reaches for one.
  if (!(await isDemonstrationVisitor())) return [];

  const { applied } = await readOverlay();
  if (applied.length === 0) return [];

  const student = await base.students.forUser(actor, actor.user.id);
  if (!student) return [];

  const college = student.collegeId
    ? await base.organizations.find(actor, student.collegeId)
    : null;

  const derived: Application[] = [];
  for (const postingId of applied) {
    // Through the repository, so the posting is scoped exactly as it would be
    // for anybody else. A cookie naming a posting in another market — or a real
    // one — resolves to nothing here.
    const posting = await base.postings.find(actor, postingId);
    if (!posting || posting.status !== "published") continue;
    derived.push(
      derive(
        posting,
        student.id,
        scoreMatch(student, posting, college?.county ?? posting.county),
        student.verifiedOn ?? new Date().toISOString(),
      ),
    );
  }
  return derived;
}

/** Adds the visitor's derived applications; passes everything else through. */
export function withVisitorOverlay(base: Repositories): Repositories {
  const merge = async (rows: Application[], actor: ActorContext, keep?: (a: Application) => boolean) => {
    const derived = await derivedFor(base, actor);
    if (derived.length === 0) return rows;
    const already = new Set(rows.map((a) => a.id));
    const extra = derived.filter((a) => !already.has(a.id) && (keep?.(a) ?? true));
    return [...rows, ...extra];
  };

  return {
    ...base,
    applications: {
      ...base.applications,
      list: async (actor) => merge(await base.applications.list(actor), actor),
      forStudent: async (actor, studentId) =>
        merge(await base.applications.forStudent(actor, studentId), actor, (a) => a.studentId === studentId),
      forPosting: async (actor, postingId) =>
        merge(await base.applications.forPosting(actor, postingId), actor, (a) => a.postingId === postingId),
      find: async (actor, id) => {
        const found = await base.applications.find(actor, id);
        if (found) return found;
        const derived = await derivedFor(base, actor);
        return derived.find((a) => a.id === id) ?? null;
      },
    },
  };
}
