/**
 * The sign-in flow.
 *
 * The most security-critical code in the repository, so these test the
 * refusals as hard as the happy path — a code that works is easy, and a code
 * that stops working when it should is the whole point.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  endSession,
  requestSignInCode,
  resolveSessionToken,
  verifySignInCode,
  type SignInDeps,
} from "./auth";
import { resetAuthState } from "@/auth/memory-store";
import { CODE_MAX_ATTEMPTS, CODE_TTL_MS, sessionLifetimeFor } from "@/domain/identity";
import * as seed from "@/data/seed";

/** The seeded college director — an `email_code` organization. */
const COLLEGE_EMAIL = "evance@verdigris.example.edu";
/** The seeded board officer — a `federated` organization, so locked out. */
const BOARD_EMAIL = "mdelgado@sekwp.example.org";

let clock = new Date("2026-06-01T12:00:00.000Z");
let delivered: { to: string; code: string }[] = [];

const deps: SignInDeps = {
  now: () => clock,
  async deliver(to, code) {
    delivered.push({ to, code });
  },
};

function advance(ms: number) {
  clock = new Date(clock.getTime() + ms);
}

beforeEach(() => {
  resetAuthState();
  clock = new Date("2026-06-01T12:00:00.000Z");
  delivered = [];
});

async function signIn(email = COLLEGE_EMAIL) {
  await requestSignInCode(email, deps);
  const code = delivered.at(-1)!.code;
  return verifySignInCode(email, code, deps);
}

describe("asking for a code", () => {
  it("sends one to a known work address", async () => {
    const result = await requestSignInCode(COLLEGE_EMAIL, deps);
    expect(result.ok).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe(COLLEGE_EMAIL);
  });

  it("reports success for an address it does not hold, and sends nothing", async () => {
    // Sign-on is the one page anyone can reach. An honest "no such account" is
    // a free directory of who takes part in this programme — including which
    // public employees work on it.
    const result = await requestSignInCode("nobody@elsewhere.example", deps);
    expect(result.ok).toBe(true);
    expect(delivered).toHaveLength(0);
  });

  it("is case- and whitespace-insensitive about the address", async () => {
    const result = await requestSignInCode(`  ${COLLEGE_EMAIL.toUpperCase()} `, deps);
    expect(result.ok).toBe(true);
    expect(delivered).toHaveLength(1);
  });

  it("rejects something that is not an address at all", async () => {
    expect((await requestSignInCode("ellen", deps)).ok).toBe(false);
  });

  it("replaces an outstanding code rather than leaving two live", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const first = delivered[0].code;
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const second = delivered[1].code;
    expect(first).not.toBe(second);

    const stale = await verifySignInCode(COLLEGE_EMAIL, first, deps);
    expect(stale.ok).toBe(false);
    expect((await verifySignInCode(COLLEGE_EMAIL, second, deps)).ok).toBe(true);
  });
});

describe("a federated organization", () => {
  it("is refused, and told where to go instead", async () => {
    // The board is a government organization. No SSO adapter ships, so its
    // officers cannot sign in here at all — which is correct, not a gap.
    const result = await requestSignInCode(BOARD_EMAIL, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/own identity provider/i);
    expect(delivered).toHaveLength(0);
  });

  it("cannot be talked into a session by any code", async () => {
    expect((await verifySignInCode(BOARD_EMAIL, "ABCD2345", deps)).ok).toBe(false);
  });

  it("is the seeded state, not something a test invented", () => {
    const board = seed.organizations.find((o) => o.kind === "board")!;
    expect(board.identityMode).toBe("federated");
  });
});

describe("presenting a code", () => {
  it("creates a session for the right person", async () => {
    const result = await signIn();
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.actor.user.email).toBe(COLLEGE_EMAIL);
    expect(result.actor.membership.role).toBe("college");
    expect(result.token.length).toBeGreaterThan(20);
  });

  it("accepts a code typed in lower case with stray spacing", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const code = delivered[0].code;
    const result = await verifySignInCode(COLLEGE_EMAIL, `  ${code.toLowerCase()} `, deps);
    expect(result.ok).toBe(true);
  });

  it("refuses a wrong code without saying which part was wrong", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const result = await verifySignInCode(COLLEGE_EMAIL, "22222222", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid/i);
  });

  it("cannot be used twice", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const code = delivered[0].code;
    expect((await verifySignInCode(COLLEGE_EMAIL, code, deps)).ok).toBe(true);
    expect((await verifySignInCode(COLLEGE_EMAIL, code, deps)).ok).toBe(false);
  });

  it("expires", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const code = delivered[0].code;
    advance(CODE_TTL_MS + 1000);
    expect((await verifySignInCode(COLLEGE_EMAIL, code, deps)).ok).toBe(false);
  });

  it("dies after a handful of wrong guesses, even if the right one follows", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const code = delivered[0].code;
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      await verifySignInCode(COLLEGE_EMAIL, "22222222", deps);
    }
    expect((await verifySignInCode(COLLEGE_EMAIL, code, deps)).ok).toBe(false);
  });

  it("refuses a code presented against a different address", async () => {
    await requestSignInCode(COLLEGE_EMAIL, deps);
    const code = delivered[0].code;
    expect((await verifySignInCode("dreyes@apexrobotics.example.com", code, deps)).ok).toBe(
      false,
    );
  });

  it("revokes other sessions for the same account", async () => {
    // Signing in is the moment somebody can prove who they are, and the
    // cheapest place to make a stolen session on another machine stop working.
    const first = await signIn();
    expect(first.ok).toBe(true);
    if (first.ok !== true) return;

    const second = await signIn();
    expect(second.ok).toBe(true);

    expect(await resolveSessionToken(first.token, deps)).toBeNull();
  });
});

describe("resolving a session", () => {
  it("returns the actor every repository read is scoped by", async () => {
    const signedIn = await signIn();
    if (signedIn.ok !== true) throw new Error("sign-in failed");

    const actor = await resolveSessionToken(signedIn.token, deps);
    expect(actor?.membership.role).toBe("college");
    expect(actor?.membership.marketId).toBe("mkt-pittsburg");
  });

  it("returns nothing for a token nobody issued", async () => {
    expect(await resolveSessionToken("not-a-real-token", deps)).toBeNull();
  });

  it("stops working once the absolute lifetime is up", async () => {
    const signedIn = await signIn();
    if (signedIn.ok !== true) throw new Error("sign-in failed");

    advance(sessionLifetimeFor("college").absoluteMs + 1000);
    expect(await resolveSessionToken(signedIn.token, deps)).toBeNull();
  });

  it("stops working after an idle stretch, and does not come back", async () => {
    const signedIn = await signIn();
    if (signedIn.ok !== true) throw new Error("sign-in failed");

    advance(sessionLifetimeFor("college").idleMs + 1000);
    expect(await resolveSessionToken(signedIn.token, deps)).toBeNull();

    // Revoked on the way out rather than merely refused, so a later request
    // inside the window cannot revive it.
    advance(-500);
    expect(await resolveSessionToken(signedIn.token, deps)).toBeNull();
  });

  it("keeps working while somebody is using it", async () => {
    const signedIn = await signIn();
    if (signedIn.ok !== true) throw new Error("sign-in failed");

    const { idleMs } = sessionLifetimeFor("college");
    for (let i = 0; i < 4; i++) {
      advance(idleMs - 1000);
      expect(await resolveSessionToken(signedIn.token, deps)).not.toBeNull();
    }
  });

  it("stops working after signing out", async () => {
    const signedIn = await signIn();
    if (signedIn.ok !== true) throw new Error("sign-in failed");

    await endSession(signedIn.token, deps);
    expect(await resolveSessionToken(signedIn.token, deps)).toBeNull();
  });
});
