/**
 * Per-partner theming.
 *
 * An education partner's students should see their school, not a vendor. That
 * is a procurement requirement as often as an aesthetic one, and it is cheap
 * here because the design tokens are CSS custom properties: overriding
 * `--color-brand-*` on a wrapper retints all eighty `brand-*` class usages
 * without touching a single one of them.
 *
 * **What a partner controls:** a colour and a logo. Nothing else.
 *
 * They do not control copy. Copy carries obligations — "the board must
 * determine your eligibility before this placement can be funded" is a
 * statement about a funding rule, and a partner who can edit it can misstate
 * it in a way that traces back to the platform. They also do not control the
 * demonstration notice, which has to survive every theme.
 *
 * **Whose theme applies:** the school the student attends. For most students
 * that is their college; for a dual-credit high school student it is the high
 * school. Resolution therefore keys on an *education organization* rather than
 * on "college", so secondary inherits this the day it is modelled.
 */

import type { Organization } from "@/domain/types";
import { brand } from "@/brand";
import { accentFromHue, hueOf, rampFromHue, type Accent, type Ramp } from "./ramp";

export interface PartnerTheme {
  /** Whose theme this is, for the "themed by" attribution. */
  organizationName: string;
  ramp: Ramp;
  /**
   * The school's second colour, when they have one. Absent for the platform's
   * own look, which is deliberately single-colour — a vendor with two brand
   * colours competing with a school's two is noise.
   */
  accent?: Accent;
  /** Optional mark. Falls back to the platform monogram when absent. */
  logoUrl?: string;
  /** Two-letter fallback when there is no logo. */
  monogram: string;
}

/** The platform's own look, used wherever no partner owns the surface. */
export function platformTheme(): PartnerTheme {
  return {
    organizationName: brand.name,
    ramp: rampFromHue(PLATFORM_HUE),
    monogram: brand.monogram,
  };
}

/**
 * The sky hue this product shipped with. Generating from it rather than
 * hardcoding the original hex means the platform's own surfaces go through the
 * same contrast guarantees a partner's do — no privileged path.
 */
const PLATFORM_HUE = 199;

/**
 * Build a theme from an organization's stored branding.
 *
 * Returns the platform theme when the organization has set nothing, which is
 * the common case and the right default: an unbranded partner should look like
 * the platform, not like a half-configured one.
 */
export function themeFor(organization: Organization | null): PartnerTheme {
  if (!organization?.brandColor) return platformTheme();

  return {
    organizationName: organization.name,
    // The partner's exact hex is deliberately not used. It seeds a hue; the
    // ramp is computed. That is the bargain — bring your colour, we guarantee
    // it stays readable.
    ramp: rampFromHue(hueOf(organization.brandColor)),
    accent: organization.accentColor
      ? accentFromHue(hueOf(organization.accentColor))
      : undefined,
    logoUrl: organization.logoUrl,
    monogram: initialsOf(organization.name),
  };
}

/**
 * Whether a portal is a partner's surface or the platform's own.
 *
 * The administrator and the workforce board are looking at the platform doing
 * its job across many partners; theming those to one college would be wrong,
 * and for the board actively misleading.
 */
export function isPartnerSurface(pathname: string): boolean {
  return pathname.startsWith("/student") || pathname.startsWith("/college");
}

/**
 * The CSS custom properties a theme sets.
 *
 * Returned as a plain style object so it can be spread onto the element that
 * wraps a themed subtree. Only the brand ramp is overridden — ink and the
 * state colours are the product's, and a partner recolouring "this failed" is
 * not branding.
 */
export function themeVariables(theme: PartnerTheme): Record<string, string> {
  return {
    // The accent and the ink that reads on it, resolved together so a call
    // site can never pair them wrongly. Falls back to the primary when a
    // partner has only one colour, so anything using the accent still works.
    "--color-accent": theme.accent?.fill ?? theme.ramp[700],
    "--color-accent-on": theme.accent?.on ?? "#ffffff",
    "--color-brand-50": theme.ramp[50],
    "--color-brand-100": theme.ramp[100],
    "--color-brand-200": theme.ramp[200],
    "--color-brand-400": theme.ramp[400],
    "--color-brand-500": theme.ramp[500],
    "--color-brand-600": theme.ramp[600],
    "--color-brand-700": theme.ramp[700],
  };
}

/** Two letters from an organization name, for the fallback mark. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()));

  if (words.length === 0) return brand.monogram;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Dropped from initials, because "VSU" beats "VO" for Verdigris State. */
const STOP_WORDS = new Set(["of", "the", "and", "at", "for"]);
