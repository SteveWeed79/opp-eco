import { describe, it, expect } from "vitest";
import type { ConsentRecord } from "./types";
import {
  CONSENT_GRANTORS,
  CONSENT_SCOPES,
  byConsentOrder,
  canRecordConsent,
  consentScopeLabel,
  disclosureBlockReason,
  hasConsent,
  isInForce,
  recordBlockReason,
} from "./consent";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const COLLEGE = "org-college";
const SCHOOL = "org-highschool";

function consent(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: "consent-1",
    marketId: "mkt-1",
    studentId: "stu-1",
    sourceOrgId: COLLEGE,
    scope: "education_record",
    grantedBy: "learner",
    grantedOn: "2026-01-01T00:00:00.000Z",
    expiresOn: null,
    status: "granted",
    recordedByUserId: "u-college",
    version: 1,
    ...overrides,
  };
}

describe("whether a consent is in force", () => {
  it("counts an open-ended granted consent", () => {
    expect(isInForce(consent(), NOW)).toBe(true);
  });

  it("does not count a withdrawn one", () => {
    expect(isInForce(consent({ status: "withdrawn" }), NOW)).toBe(false);
  });

  it("evaluates expiry rather than trusting the status", () => {
    // A row that lapsed on a date nobody sweeps would otherwise read as granted
    // forever. A job flipping the status is an optimisation; correctness cannot
    // wait for one to run.
    const lapsed = consent({ expiresOn: "2026-05-01T00:00:00.000Z" });
    expect(lapsed.status).toBe("granted");
    expect(isInForce(lapsed, NOW)).toBe(false);
  });

  it("counts one that expires later", () => {
    expect(isInForce(consent({ expiresOn: "2026-12-01T00:00:00.000Z" }), NOW)).toBe(true);
  });
});

describe("consent belongs to the institution, not the learner", () => {
  it("does not let one institution's consent cover another's records", () => {
    // The load-bearing rule. A dual-credit placement generates records at both
    // the college and the high school, and a college release authorises
    // nothing the school holds.
    const consents = [consent({ sourceOrgId: COLLEGE })];
    expect(
      hasConsent(consents, { studentId: "stu-1", sourceOrgId: COLLEGE, scope: "education_record" }, NOW),
    ).toBe(true);
    expect(
      hasConsent(consents, { studentId: "stu-1", sourceOrgId: SCHOOL, scope: "education_record" }, NOW),
    ).toBe(false);
  });

  it("does not let one scope cover another", () => {
    // Someone happy for a college to verify enrolment to an employer may not
    // want their details going to a government agency, and a model with one
    // flag could not represent that refusal.
    const consents = [consent({ scope: "education_record" })];
    expect(
      hasConsent(consents, { studentId: "stu-1", sourceOrgId: COLLEGE, scope: "workforce_data" }, NOW),
    ).toBe(false);
  });

  it("does not let one learner's consent cover another's", () => {
    const consents = [consent({ studentId: "stu-1" })];
    expect(
      hasConsent(consents, { studentId: "stu-2", sourceOrgId: COLLEGE, scope: "education_record" }, NOW),
    ).toBe(false);
  });
});

describe("the disclosure gate", () => {
  it("permits disclosure when education-record consent is in force", () => {
    expect(
      disclosureBlockReason([consent()], { studentId: "stu-1", sourceOrgId: COLLEGE }, NOW),
    ).toBeNull();
  });

  it("refuses, and says why, when none is on file", () => {
    const reason = disclosureBlockReason([], { studentId: "stu-1", sourceOrgId: COLLEGE }, NOW);
    expect(reason).toMatch(/no education-record consent/i);
  });

  it("refuses once it has been withdrawn", () => {
    expect(
      disclosureBlockReason(
        [consent({ status: "withdrawn" })],
        { studentId: "stu-1", sourceOrgId: COLLEGE },
        NOW,
      ),
    ).not.toBeNull();
  });

  it("is not satisfied by a workforce-data consent", () => {
    // Agreeing that a board may make a determination is not agreeing that an
    // employer may have your contact details.
    expect(
      disclosureBlockReason(
        [consent({ scope: "workforce_data" })],
        { studentId: "stu-1", sourceOrgId: COLLEGE },
        NOW,
      ),
    ).not.toBeNull();
  });
});

describe("who may record one", () => {
  it("is the institution whose records it covers", () => {
    expect(canRecordConsent(COLLEGE, false, COLLEGE)).toBe(true);
  });

  it("is not another institution", () => {
    // A college cannot assert consent on behalf of a high school it does not
    // operate.
    expect(canRecordConsent(SCHOOL, false, COLLEGE)).toBe(false);
  });

  it("is an administrator for any of them", () => {
    expect(canRecordConsent(null, true, COLLEGE)).toBe(true);
  });
});

describe("recording rules", () => {
  it("accepts an open-ended consent", () => {
    expect(
      recordBlockReason({
        scope: "education_record",
        grantedBy: "learner",
        expiresOn: null,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("refuses one that has already lapsed", () => {
    // It authorises nothing, so recording it is a data-entry slip rather than a
    // decision anyone made.
    expect(
      recordBlockReason({
        scope: "education_record",
        grantedBy: "learner",
        expiresOn: "2026-01-01T00:00:00.000Z",
        now: NOW,
      }),
    ).toMatch(/expire in the past/i);
  });

  it("refuses a date that is not one", () => {
    expect(
      recordBlockReason({
        scope: "education_record",
        grantedBy: "learner",
        expiresOn: "not a date",
        now: NOW,
      }),
    ).toMatch(/not a date/i);
  });
});

describe("the vocabulary", () => {
  it("describes every scope and says who the disclosure is to", () => {
    for (const scope of CONSENT_SCOPES) {
      expect(scope.label.trim().length).toBeGreaterThan(0);
      expect(scope.meta.trim().length).toBeGreaterThan(0);
      expect(scope.description.trim().length).toBeGreaterThan(0);
      expect(consentScopeLabel(scope.value)).toBe(scope.label);
    }
  });

  it("offers both grantors, because the model records rather than derives", () => {
    expect(CONSENT_GRANTORS.map((g) => g.value)).toEqual(["learner", "parent_guardian"]);
  });

  it("orders newest first with a stable tie-break", () => {
    const rows = [
      consent({ id: "b", grantedOn: "2026-01-01T00:00:00.000Z" }),
      consent({ id: "a", grantedOn: "2026-01-01T00:00:00.000Z" }),
      consent({ id: "c", grantedOn: "2026-03-01T00:00:00.000Z" }),
    ].sort(byConsentOrder);
    expect(rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
