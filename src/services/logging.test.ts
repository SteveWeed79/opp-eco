import { describe, it, expect } from "vitest";
import { redact } from "./logging";

describe("redaction", () => {
  it("removes a student's name and email", () => {
    const output = redact({
      applicationId: "app-4",
      name: "Omar Haddad",
      email: "haddado@students.verdigris.example.edu",
    }) as Record<string, unknown>;

    expect(output.applicationId).toBe("app-4");
    expect(output.name).toBe("[redacted]");
    expect(output.email).toBe("[redacted]");
  });

  it("matches key fragments, not exact names", () => {
    const output = redact({
      studentEmail: "a@b.c",
      contact_name: "Dana Reyes",
      homeAddress: "123 Main St",
      dateOfBirth: "2004-01-01",
    }) as Record<string, unknown>;

    for (const value of Object.values(output)) expect(value).toBe("[redacted]");
  });

  it("redacts audit reasons, which routinely describe a person", () => {
    const output = redact({
      reason: "Student unreachable; guardian says they moved to Joplin",
    }) as Record<string, unknown>;
    expect(output.reason).toBe("[redacted]");
  });

  it("redacts credentials and session material", () => {
    const output = redact({
      password: "hunter2",
      authorization: "Bearer abc",
      cookie: "oe_demo_role=admin",
      apiToken: "sk-live-123",
    }) as Record<string, unknown>;
    for (const value of Object.values(output)) expect(value).toBe("[redacted]");
  });

  it("keeps identifiers, which are what actually diagnose a problem", () => {
    const output = redact({
      applicationId: "app-4",
      marketId: "mkt-pittsburg",
      status: "mutual_interest",
      hours: 210,
    }) as Record<string, unknown>;
    expect(output).toEqual({
      applicationId: "app-4",
      marketId: "mkt-pittsburg",
      status: "mutual_interest",
      hours: 210,
    });
  });

  it("reaches into nested objects", () => {
    const output = redact({
      application: { id: "app-4", student: { id: "stu-1", email: "a@b.c" } },
    }) as { application: { student: Record<string, unknown> } };
    expect(output.application.student.id).toBe("stu-1");
    expect(output.application.student.email).toBe("[redacted]");
  });

  it("keeps an Error's type and origin but drops its message", () => {
    // A message can quote the record it failed on.
    const output = redact(
      new Error("Failed to load student Omar Haddad <haddado@example.edu>"),
    ) as Record<string, unknown>;
    expect(JSON.stringify(output)).not.toContain("Omar Haddad");
    expect(output.error).toBe("Error");
  });

  it("survives a cyclic object rather than hanging", () => {
    const cyclic: Record<string, unknown> = { id: "app-4" };
    cyclic.self = cyclic;
    expect(() => JSON.stringify(redact(cyclic))).not.toThrow();
  });

  it("truncates a long string instead of emitting it whole", () => {
    const output = redact({ note: "x".repeat(5000) }) as Record<string, string>;
    expect(output.note.length).toBeLessThan(600);
    expect(output.note).toContain("truncated");
  });

  it("caps array length", () => {
    const output = redact({ ids: Array.from({ length: 500 }, (_, i) => i) }) as {
      ids: number[];
    };
    expect(output.ids).toHaveLength(20);
  });
});
