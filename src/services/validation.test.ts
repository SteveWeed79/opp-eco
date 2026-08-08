import { describe, it, expect } from "vitest";
import {
  bookInterviewInput,
  fundingAuthorizationInput,
  overrideInput,
  validate,
} from "./validation";

describe("identifier validation", () => {
  it("accepts a normal slug", () => {
    const result = validate(bookInterviewInput, {
      applicationId: "app-4",
      slotId: "slot-1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing field", () => {
    const result = validate(bookInterviewInput, { applicationId: "app-4" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("slotId");
  });

  it("rejects a non-string id", () => {
    const result = validate(bookInterviewInput, {
      applicationId: { $ne: null },
      slotId: "slot-1",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an id carrying markup", () => {
    const result = validate(bookInterviewInput, {
      applicationId: "<script>alert(1)</script>",
      slotId: "slot-1",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an absurdly long id before it reaches a log", () => {
    const result = validate(bookInterviewInput, {
      applicationId: "a".repeat(5000),
      slotId: "slot-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Too long");
  });

  it("names the offending field so the message is actionable", () => {
    const result = validate(bookInterviewInput, { applicationId: "", slotId: "s" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^applicationId:/);
  });
});

describe("funding authorization", () => {
  const base = { applicationId: "app-8", hours: 210, ratePerHour: 20 };

  it("accepts a sane authorization", () => {
    expect(validate(fundingAuthorizationInput, base).ok).toBe(true);
  });

  it("rejects NaN, which would silently commit zero", () => {
    expect(validate(fundingAuthorizationInput, { ...base, hours: NaN }).ok).toBe(false);
  });

  it("rejects negative hours", () => {
    expect(validate(fundingAuthorizationInput, { ...base, hours: -40 }).ok).toBe(false);
  });

  it("rejects fractional hours", () => {
    expect(validate(fundingAuthorizationInput, { ...base, hours: 12.5 }).ok).toBe(false);
  });

  it("rejects a typo with an extra zero", () => {
    expect(validate(fundingAuthorizationInput, { ...base, hours: 21000 }).ok).toBe(false);
  });

  it("rejects a numeric string, which would concatenate rather than multiply", () => {
    const result = validate(fundingAuthorizationInput, { ...base, hours: "210" });
    expect(result.ok).toBe(false);
  });
});

describe("override reasons", () => {
  it("requires a reason", () => {
    const result = validate(overrideInput, { applicationId: "app-9", to: "shortlisted" });
    expect(result.ok).toBe(false);
  });

  it("rejects whitespace masquerading as a reason", () => {
    const result = validate(overrideInput, {
      applicationId: "app-9",
      to: "shortlisted",
      reason: "     ",
    });
    expect(result.ok).toBe(false);
  });

  it("trims a valid reason", () => {
    const result = validate(overrideInput, {
      applicationId: "app-9",
      to: "shortlisted",
      reason: "  Business unresponsive for 21 days  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reason).toBe("Business unresponsive for 21 days");
  });

  it("bounds reason length so one request cannot bloat the audit log", () => {
    const result = validate(overrideInput, {
      applicationId: "app-9",
      to: "shortlisted",
      reason: "x".repeat(5000),
    });
    expect(result.ok).toBe(false);
  });
});
