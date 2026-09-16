import { describe, it, expect } from "vitest";
import { AuthConfigError, authConfig, demoSignOnEnabled } from "./config";

describe("which sign-on runs", () => {
  it("defaults to the role picker, so a bare checkout is walkable", () => {
    expect(authConfig({}).mode).toBe("demo");
    expect(demoSignOnEnabled({})).toBe(true);
  });

  it("switches on AUTH_MODE=code", () => {
    expect(authConfig({ AUTH_MODE: "code", RESEND_API_KEY: "re_x" }).mode).toBe("code");
  });

  it("treats an unknown AUTH_MODE as the safe default rather than guessing", () => {
    expect(authConfig({ AUTH_MODE: "sso" }).mode).toBe("demo");
  });
});

describe("the guard on demo sign-on", () => {
  it("refuses the role picker against a writable database", () => {
    // Keyed on real-and-writable rather than NODE_ENV, which says nothing about
    // whether the records are real — a deployed demo is production and holds
    // fixtures. This is the combination where anyone could become anyone and
    // change somebody's actual data.
    expect(() =>
      authConfig({ DATABASE_URL: "postgres://x", DATABASE_READ_ONLY: "false" }),
    ).toThrow(AuthConfigError);
  });

  it("allows it against a read-only database, which is the deployed demo", () => {
    expect(authConfig({ DATABASE_URL: "postgres://x" }).mode).toBe("demo");
  });

  it("allows it with no database at all", () => {
    expect(authConfig({ NODE_ENV: "production" }).mode).toBe("demo");
  });

  it("opens for a database the operator has called throwaway by hand", () => {
    // The end-to-end suite needs this exact combination, and runs a production
    // build, so nothing about the process distinguishes it from a deployment.
    expect(
      authConfig({
        DATABASE_URL: "postgres://x",
        DATABASE_READ_ONLY: "false",
        AUTH_DEMO_WRITABLE_DB: "i-am-a-test-database",
      }).mode,
    ).toBe("demo");
  });

  it.each(["true", "1", "yes", "", "I-AM-A-TEST-DATABASE"])(
    "stays shut for %o, because the awkward value is the whole safeguard",
    (value) => {
      expect(() =>
        authConfig({
          DATABASE_URL: "postgres://x",
          DATABASE_READ_ONLY: "false",
          AUTH_DEMO_WRITABLE_DB: value,
        }),
      ).toThrow(AuthConfigError);
    },
  );
});

describe("the guard on real sign-on", () => {
  it("refuses when no code could be delivered", () => {
    // A code nobody can receive is an account nobody can reach — and the
    // tempting workaround, letting it surface in the outbox, would publish a
    // bearer token for every account.
    expect(() => authConfig({ AUTH_MODE: "code" })).toThrow(AuthConfigError);
  });

  it("accepts a development echo instead of a mail key", () => {
    const config = authConfig({ AUTH_MODE: "code", AUTH_ECHO_CODES: "true" });
    expect(config.mode).toBe("code");
    expect(config.echoCodes).toBe(true);
  });

  it("refuses to echo codes in production", () => {
    expect(() =>
      authConfig({
        AUTH_MODE: "code",
        AUTH_ECHO_CODES: "true",
        RESEND_API_KEY: "re_x",
        NODE_ENV: "production",
      }),
    ).toThrow(AuthConfigError);
  });

  it("never echoes in production even when asked politely", () => {
    const config = authConfig({
      AUTH_MODE: "code",
      RESEND_API_KEY: "re_x",
      NODE_ENV: "production",
    });
    expect(config.echoCodes).toBe(false);
  });
});
