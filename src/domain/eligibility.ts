/**
 * How long a board's eligibility determination stands.
 *
 * One rule, in one place, because it was previously two: the fixtures computed
 * an expiry from today, the Postgres mapper computed one from the determination
 * date, and the same student therefore had two different expiries depending on
 * which data layer answered. The number is still an assumption rather than a
 * policy — when the real clearance rule is settled, this is the file it lands
 * in, and both layers pick it up without either being edited.
 */

export const CLEARANCE_WINDOW_DAYS = 365;

/**
 * When a determination made on `determinedOn` lapses.
 *
 * Derived rather than stored. Two dates that can disagree is a support ticket:
 * an expiry that contradicts its own determination is worse than one computed
 * on every read, and the schema keeps only the determination for that reason.
 */
export function clearanceExpiry(determinedOn: string | null): string | null {
  if (!determinedOn) return null;
  return new Date(
    new Date(determinedOn).getTime() + CLEARANCE_WINDOW_DAYS * 86_400_000,
  ).toISOString();
}
