import { describe, it, expect } from "vitest";
import type { Organization, Session } from "./types";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  addressMatchesOrganization,
  defaultIdentityMode,
  domainOf,
  isPrivileged,
  normaliseEmail,
  sessionLifetimeFor,
  sessionState,
  signInBlockReason,
} from "./identity";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function organization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    marketId: "mkt-1",
    kind: "college",
    name: "Verdigris State University",
    county: "Crawford",
    status: "active",
    contactName: "Dr. Ellen Vance",
    contactEmail: "evance@verdigris.example.edu",
    appliedOn: "2026-01-01T00:00:00.000Z",
    identityMode: "email_code",
    emailDomains: ["verdigris.example.edu"],
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "hash",
    userId: "u-1",
    createdAt: "2026-06-01T11:00:00.000Z",
    expiresAt: "2026-06-01T19:00:00.000Z",
    lastSeenAt: "2026-06-01T11:55:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

describe("a government organization is locked to its own provider", () => {
  it("refuses the platform's own sign-in path outright", () => {
    // Not a fallback to something else — no adapter ships — so this genuinely
    // locks the organization out. That is the intended failure: a board's
    // officers are public employees whose agency owns their identity, and the
    // alternative is this platform minting them a credential because waiting
    // was inconvenient.
    const board = organization({ kind: "board", identityMode: "federated", name: "SEKWP" });
    expect(signInBlockReason(board, "mdelgado@sekwp.example.org")).toMatch(
      /own identity provider/i,
    );
  });

  it("refuses even an address on the organization's own domain", () => {
    const board = organization({ identityMode: "federated", emailDomains: ["sekwp.example.org"] });
    expect(signInBlockReason(board, "anyone@sekwp.example.org")).not.toBeNull();
  });

  it("defaults a board to codes and everything else to passwords", () => {
    // A government organization holds no password here — that part has not
    // moved. What moved is what "no password" costs them: `federated` with no
    // adapter shipped meant a board officer could not use the platform at all,
    // which does not make a pilot safer. A one-time code to their agency
    // address is what they get, and federation remains the upgrade.
    expect(defaultIdentityMode("board")).toBe("email_code");

    // And the rest get passwords, because the rule about replicating a
    // government identity was never about a sophomore at a community college.
    for (const kind of ["college", "business", "nonprofit"] as const) {
      expect(defaultIdentityMode(kind)).toBe("password");
    }
  });

  it("asks no second factor of a government account", async () => {
    const { requiresSecondFactor } = await import("./identity");
    // Deliberate, and not a weaker choice than issuing one. A board officer's
    // factor is their agency's mailbox, which their own IT department already
    // protects; handing them an authenticator seed would mean this platform
    // holding a second credential for a public employee, which is the thing the
    // data rules say not to do.
    expect(requiresSecondFactor("board")).toBe(false);
    // The administrator is ours, reads every market, and is offered one.
    expect(requiresSecondFactor("admin")).toBe(true);
    for (const role of ["college", "business", "student"] as const) {
      expect(requiresSecondFactor(role)).toBe(false);
    }
  });
});

describe("work-address binding", () => {
  it("accepts an address on the declared domain", () => {
    expect(signInBlockReason(organization(), "evance@verdigris.example.edu")).toBeNull();
  });

  it("refuses a personal address, and says to use the work one", () => {
    // The control that stops a public employee's account being bound to a
    // mailbox their agency cannot revoke.
    expect(signInBlockReason(organization(), "ellen@gmail.example.com")).toMatch(
      /work address/i,
    );
  });

  it("accepts a subdomain, because agencies run mail on them", () => {
    expect(
      addressMatchesOrganization("m@wioa.verdigris.example.edu", {
        emailDomains: ["verdigris.example.edu"],
      }),
    ).toBe(true);
  });

  it("does not accept a domain that merely ends the same way", () => {
    // `notverdigris.example.edu` must not pass a check for
    // `verdigris.example.edu`. The dot in the subdomain rule is what does it.
    expect(
      addressMatchesOrganization("m@notverdigris.example.edu", {
        emailDomains: ["verdigris.example.edu"],
      }),
    ).toBe(false);
  });

  it("accepts anything when an organization declares no domains", () => {
    // Where every organization starts, and where a small employer on a shared
    // mailbox stays.
    expect(addressMatchesOrganization("whoever@anywhere.example", { emailDomains: [] })).toBe(
      true,
    );
  });

  it("refuses a suspended organization before looking at the address", () => {
    expect(
      signInBlockReason(organization({ status: "suspended" }), "evance@verdigris.example.edu"),
    ).toMatch(/not currently taking part/i);
  });

  it("normalises case and whitespace on both sides", () => {
    expect(normaliseEmail("  EVance@Verdigris.Example.EDU ")).toBe(
      "evance@verdigris.example.edu",
    );
    expect(domainOf("EVance@Verdigris.Example.EDU")).toBe("verdigris.example.edu");
  });
});

describe("session lifetimes", () => {
  it("gives the privileged roles the shortest idle window", () => {
    // Cross-market reads, eligibility determinations and public money. A shared
    // laptop in a workforce office left signed in overnight is the realistic
    // threat, and the idle window is what addresses it.
    for (const role of ["admin", "board"] as const) {
      expect(isPrivileged(role)).toBe(true);
      expect(sessionLifetimeFor(role).idleMs).toBeLessThan(
        sessionLifetimeFor("student").idleMs,
      );
    }
  });

  it("gives a learner the longest, because friction lands worst on them", () => {
    expect(sessionLifetimeFor("student").absoluteMs).toBeGreaterThan(
      sessionLifetimeFor("admin").absoluteMs,
    );
  });

  it("never lets the idle window exceed the absolute one", () => {
    for (const role of ["admin", "board", "college", "business", "student"] as const) {
      const { absoluteMs, idleMs } = sessionLifetimeFor(role);
      expect(idleMs).toBeLessThanOrEqual(absoluteMs);
    }
  });
});

describe("whether a session is still good", () => {
  it("accepts a fresh one", () => {
    expect(sessionState(session(), "student", NOW)).toBe("active");
  });

  it("rejects a revoked one first", () => {
    expect(sessionState(session({ revokedAt: "2026-06-01T11:30:00.000Z" }), "student", NOW)).toBe(
      "revoked",
    );
  });

  it("rejects one past its hard stop", () => {
    expect(
      sessionState(session({ expiresAt: "2026-06-01T11:00:00.000Z" }), "student", NOW),
    ).toBe("expired");
  });

  it("rejects one nobody has touched, by role", () => {
    // The same session: still active for a learner, idle for a board officer.
    // Checking only the absolute window would hold the second open all weekend.
    const stale = session({ lastSeenAt: "2026-06-01T11:00:00.000Z" });
    expect(sessionState(stale, "student", NOW)).toBe("active");
    expect(sessionState(stale, "board", NOW)).toBe("idle");
  });
});

describe("the code format", () => {
  it("omits characters people confuse", () => {
    for (const ambiguous of ["0", "O", "1", "I", "L"]) {
      expect(CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("carries enough entropy that the attempt limit is not what saves it", () => {
    const bits = Math.log2(CODE_ALPHABET.length) * CODE_LENGTH;
    expect(bits).toBeGreaterThan(35);
  });

  it("expires in minutes and dies after a handful of guesses", () => {
    expect(CODE_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(CODE_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
