/**
 * Working out whose theme applies to this request.
 *
 * Server-side, because it reads through the repositories. The result is a
 * plain object of CSS variable strings so it can cross into the client shell
 * without dragging the domain with it.
 *
 * The rule is **the school the student attends**, which is why this resolves an
 * education organization rather than "the college": for a dual-credit high
 * school student it will be the high school, and nothing here changes when
 * secondary is modelled.
 */

import type { ActorContext, Organization } from "@/domain/types";
import { repositories } from "@/data/memory";
import { systemContext } from "@/auth/system";
import { themeFor, themeVariables } from "./theme";

/** Everything the shell needs, already serialisable. */
export interface ResolvedTheme {
  variables: Record<string, string>;
  organizationName: string;
  monogram: string;
  logoUrl?: string;
  /** False when this is the platform's own look rather than a partner's. */
  isPartner: boolean;
  /** Whether the partner supplied a second colour. */
  hasAccent: boolean;
}

export function resolvePartnerTheme(actor: ActorContext | null): ResolvedTheme {
  const organization = educationOrganizationFor(actor);
  const theme = themeFor(organization);

  return {
    variables: themeVariables(theme),
    organizationName: theme.organizationName,
    monogram: theme.monogram,
    logoUrl: theme.logoUrl,
    isPartner: Boolean(organization?.brandColor),
    hasAccent: Boolean(organization?.accentColor),
  };
}

/**
 * The education organization whose brand this viewer should see.
 *
 * Signed out, this falls back to the demo student's college — matching what
 * `actorForPortal` already does for the page itself, so a bare link to
 * `/student` is themed the same way a signed-in visit is. Without that the
 * demonstration would only show theming to someone who signed in first, which
 * is the one thing most visitors never do.
 */
function educationOrganizationFor(actor: ActorContext | null): Organization | null {
  const system = systemContext();

  if (actor?.membership.role === "college" && actor.membership.organizationId) {
    return repositories.organizations.find(system, actor.membership.organizationId);
  }

  if (actor?.membership.role === "student") {
    const student = repositories.students.forUser(actor, actor.user.id);
    return student
      ? repositories.organizations.find(system, student.collegeId)
      : null;
  }

  // Administrators, employers and boards look at the platform, not at one
  // partner — theming the board's console to a single college would be
  // actively misleading about what they are looking at. The shell also gates
  // on the route, so this value is unused for them; returning the demo
  // college keeps signed-out browsing themed.
  if (actor) return null;

  const demoStudent = repositories.students.list(system)[0];
  return demoStudent
    ? repositories.organizations.find(system, demoStudent.collegeId)
    : null;
}
