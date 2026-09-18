/**
 * Whether the rows on screen are the demonstration's.
 *
 * The banner says "every organization, student, and figure shown is
 * fictional". That is a claim about **rows**, and it used to be decided by
 * `AUTH_MODE` — a property of the process, which cannot know whether it is
 * true. A deployment running real sign-on over seeded fixtures was telling the
 * truth and had no way to say so; one holding a real programme would have gone
 * on printing the disclaimer over somebody's actual learners.
 *
 * So it is answered from the data now, and the answer differs by role for a
 * reason that is structural rather than fiddly: an administrator is the only
 * actor not anchored to a market, so they are the only one who has to be asked
 * which world they meant. Everyone else has a market, and the market knows.
 *
 * Resolved in the root layout rather than in the shell, which is a client
 * component and cannot read repositories — the same division `resolvePartnerTheme`
 * already follows.
 */

import { viewsDemoData } from "@/domain/identity";
import type { ActorContext } from "@/domain/types";
import { repositories } from "@/data/backend";

export async function showsDemonstrationData(
  actor: ActorContext | null,
): Promise<boolean> {
  /**
   * Nobody signed in.
   *
   * Under the role picker every row is a fixture. Under real sign-on a portal
   * refuses before it renders anything, so this mostly does not arise — and
   * where it does, claiming fiction about rows nobody was shown is the error
   * worth making. The other direction lets an invented figure be read as real,
   * which is the failure this whole flag exists to prevent.
   */
  if (!actor) return true;

  if (actor.membership.role === "admin") return viewsDemoData(actor);

  const marketId = actor.membership.marketId;
  if (!marketId) return true;

  // Scoped through the actor like every other read. A market they cannot see
  // comes back null, and the safe answer for "I could not tell" is the same as
  // for "nobody is signed in".
  const market = await repositories.markets.find(actor, marketId);
  return market?.isDemoData ?? true;
}
