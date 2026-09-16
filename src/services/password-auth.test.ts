import { describe, it, expect, beforeEach } from "vitest";
import {
  requestPasswordReset,
  resetPassword,
  setOwnPassword,
  signInMethodForAddress,
  verifyPasswordSignIn,
} from "./password-auth";
import { authStore } from "@/auth/backend";
import { resetAuthState } from "@/auth/memory-store";
import { hashPassword } from "@/domain/password";
import { CODE_MAX_ATTEMPTS, CODE_TTL_MS } from "@/domain/identity";
import { contextFor } from "@/data/session";
import { brandAddress } from "@/brand";
import * as seed from "@/data/seed";

/**
 * Password sign-on.
 *
 * The assertions that matter are the refusals: an address that does not exist
 * and a password that is wrong have to fail identically, and which method an
 * address uses must be answerable without saying whether the account is real.
 */

let clock = new Date("2026-06-01T12:00:00.000Z");
let delivered: { to: string; code: string }[] = [];

const deps = {
  now: () => clock,
  async deliver(to: string, code: string) {
    delivered.push({ to, code });
  },
};

const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const COLLEGE = "evance@verdigris.example.edu";
const BOARD = "mdelgado@sekwp.example.org";
const ADMIN = brandAddress("admin");
const GOOD = "the quiet kansas afternoon";

beforeEach(async () => {
  resetAuthState();
  clock = new Date("2026-06-01T12:00:00.000Z");
  delivered = [];
});

/** Give somebody a password without going through a flow. */
async function givePassword(email: string, password = GOOD, mustChange = false) {
  const store = authStore();
  const user = (await store.findUserByEmail(email))!;
  await store.putPassword({
    userId: user.id,
    hash: await hashPassword(password),
    updatedAt: clock.toISOString(),
    mustChange,
  });
  return user;
}

describe("which door an address uses", () => {
  it("sends a college to a password", async () => {
    expect(await signInMethodForAddress(COLLEGE)).toBe("password");
  });

  it("sends a government address to a code", async () => {
    expect(await signInMethodForAddress(BOARD)).toBe("email_code");
  });

  it("sends the administrator to a password", async () => {
    // Cross-market, belongs to no organization. The old fallback gave the
    // widest-access account the treatment designed for public employees whose
    // agency protects their mailbox — and an administrator has no agency.
    expect(await signInMethodForAddress(ADMIN)).toBe("password");
  });

  it("answers for the domain, not for whether the person exists", async () => {
    // The property that stops this being a directory. Probing an agency's
    // domain reveals how that agency signs in — an institutional arrangement,
    // not a secret — and nothing about which officers have accounts.
    const invented = "nobody.at.all@sekwp.example.org";
    expect(await signInMethodForAddress(invented)).toBe("email_code");
    expect(await signInMethodForAddress(BOARD)).toBe("email_code");
  });

  it("answers password for a domain nobody has declared", async () => {
    expect(await signInMethodForAddress("someone@unrelated.example")).toBe("password");
  });
});

describe("signing in", () => {
  it("accepts the right password", async () => {
    await givePassword(COLLEGE);
    const result = await verifyPasswordSignIn(COLLEGE, GOOD, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.membership.role).toBe("college");
  });

  it("refuses the wrong password", async () => {
    await givePassword(COLLEGE);
    expect((await verifyPasswordSignIn(COLLEGE, "not the password", deps)).ok).toBe(
      false,
    );
  });

  it("fails an unknown address in the same words as a wrong password", async () => {
    // Two different failures that must not be distinguishable, because the
    // difference between them is a directory of who takes part.
    await givePassword(COLLEGE);
    const wrong = await verifyPasswordSignIn(COLLEGE, "not the password", deps);
    const unknown = await verifyPasswordSignIn("nobody@nowhere.example", GOOD, deps);
    expect(wrong.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!wrong.ok && !unknown.ok) expect(unknown.error).toBe(wrong.error);
  });

  it("fails an account with no password set in the same words", async () => {
    const result = await verifyPasswordSignIn(COLLEGE, GOOD, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/do not match/i);
  });

  it("tells a government account to use a code instead", async () => {
    // Said plainly rather than refused generically: the person needs to know to
    // look in their mailbox, and how their agency signs in is not a secret
    // about them.
    const result = await verifyPasswordSignIn(BOARD, GOOD, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/one-time code/i);
  });

  it("reports a password an administrator must change", async () => {
    await givePassword(ADMIN, GOOD, true);
    const result = await verifyPasswordSignIn(ADMIN, GOOD, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mustChange).toBe(true);
  });
});

describe("choosing one", () => {
  it("stores it and signs the account out everywhere", async () => {
    // Changing a password is what somebody does after they think it was seen.
    // Leaving the sessions it protected alive makes the change cosmetic.
    const actor = contextFor("college");
    const store = authStore();
    await store.createSession({
      id: "an-old-session",
      userId: actor.user.id,
      createdAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + 3_600_000).toISOString(),
      lastSeenAt: clock.toISOString(),
      revokedAt: null,
    });

    expect((await setOwnPassword(actor, GOOD, deps)).ok).toBe(true);
    expect((await store.findSession("an-old-session"))?.revokedAt).not.toBeNull();
    expect((await verifyPasswordSignIn(actor.user.email, GOOD, deps)).ok).toBe(true);
  });

  it("refuses one that breaks the policy, and changes nothing", async () => {
    const actor = contextFor("college");
    await givePassword(actor.user.email);
    const result = await setOwnPassword(actor, "short", deps);
    expect(result.ok).toBe(false);
    // The old one still works.
    expect((await verifyPasswordSignIn(actor.user.email, GOOD, deps)).ok).toBe(true);
  });
});

describe("resetting one", () => {
  it("emails a code and accepts it", async () => {
    await givePassword(COLLEGE);
    await requestPasswordReset(COLLEGE, deps);
    expect(delivered).toHaveLength(1);

    const result = await resetPassword(COLLEGE, delivered[0].code, "a whole new phrase", deps);
    expect(result.ok).toBe(true);
    expect((await verifyPasswordSignIn(COLLEGE, "a whole new phrase", deps)).ok).toBe(true);
    // The old one is gone.
    expect((await verifyPasswordSignIn(COLLEGE, GOOD, deps)).ok).toBe(false);
  });

  it("reports success for an address it does not hold, and sends nothing", async () => {
    expect((await requestPasswordReset("nobody@nowhere.example", deps)).ok).toBe(true);
    expect(delivered).toHaveLength(0);
  });

  it("gives a first password to an account that has never had one", async () => {
    // How every password in the system comes to exist. Nothing here has a
    // self-serve signup: an administrator or an import creates the account, and
    // the person chooses their own password after a code reaches the address
    // their organization knows them by — which is also why nobody is ever told
    // a password over the phone.
    //
    // Nothing is given to this account first, deliberately. When this path did
    // not work, an account with no stored password had no way in at all: the
    // form resolves a college to `password`, and the password it does not have
    // is the only thing it would be asked for.
    const store = authStore();
    const user = (await store.findUserByEmail(COLLEGE))!;
    expect(await store.findPassword(user.id)).toBeNull();

    await requestPasswordReset(COLLEGE, deps);
    expect(delivered).toHaveLength(1);

    const chosen = "the first kansas afternoon";
    expect((await resetPassword(COLLEGE, delivered[0].code, chosen, deps)).ok).toBe(true);
    expect((await verifyPasswordSignIn(COLLEGE, chosen, deps)).ok).toBe(true);
  });

  it("lets the first administrator into a fresh deployment the same way", async () => {
    // The bootstrap. An administrator has no organization, so `signInMethodFor`
    // answers `password` — and on a deployment nobody has signed into yet there
    // is no password and nobody to set one. The emailed code is the way in, and
    // if it stopped working a new install would have no reachable account.
    await requestPasswordReset(ADMIN, deps);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe(ADMIN);

    const chosen = "a long enough opening phrase";
    expect((await resetPassword(ADMIN, delivered[0].code, chosen, deps)).ok).toBe(true);
    expect((await verifyPasswordSignIn(ADMIN, chosen, deps)).ok).toBe(true);
  });

  it("sends nothing to an account that has no password to reset", async () => {
    // A government account signs in with a code. A reset code would be a second
    // code that does something different, arriving unasked.
    await requestPasswordReset(BOARD, deps);
    expect(delivered).toHaveLength(0);
  });

  it("does not invalidate a sign-in code somebody is already holding", async () => {
    // The reason codes carry a purpose. Two people are not racing here — one
    // person asked for both, and neither should cancel the other.
    const { requestSignInCode } = await import("./auth");
    await givePassword(ADMIN);
    const store = authStore();
    const user = (await store.findUserByEmail(ADMIN))!;

    await requestSignInCode(ADMIN, { now: () => clock, deliver: deps.deliver });
    await requestPasswordReset(ADMIN, deps);

    expect(await store.findSignInCode(user.id, "sign_in")).not.toBeNull();
    expect(await store.findSignInCode(user.id, "password_reset")).not.toBeNull();
  });

  it("refuses a sign-in code presented as a reset", async () => {
    const { requestSignInCode } = await import("./auth");
    await givePassword(COLLEGE);
    await requestSignInCode(COLLEGE, { now: () => clock, deliver: deps.deliver });
    const signInCode = delivered.at(-1)!.code;

    const result = await resetPassword(COLLEGE, signInCode, "a whole new phrase", deps);
    expect(result.ok).toBe(false);
  });

  it("expires", async () => {
    await givePassword(COLLEGE);
    await requestPasswordReset(COLLEGE, deps);
    advance(CODE_TTL_MS + 1000);
    expect(
      (await resetPassword(COLLEGE, delivered[0].code, "a whole new phrase", deps)).ok,
    ).toBe(false);
  });

  it("works once", async () => {
    await givePassword(COLLEGE);
    await requestPasswordReset(COLLEGE, deps);
    const code = delivered[0].code;
    expect((await resetPassword(COLLEGE, code, "a whole new phrase", deps)).ok).toBe(true);
    expect((await resetPassword(COLLEGE, code, "another new phrase", deps)).ok).toBe(false);
  });

  it("dies after a handful of wrong guesses", async () => {
    await givePassword(COLLEGE);
    await requestPasswordReset(COLLEGE, deps);
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      await resetPassword(COLLEGE, "22222222", "a whole new phrase", deps);
    }
    expect(
      (await resetPassword(COLLEGE, delivered[0].code, "a whole new phrase", deps)).ok,
    ).toBe(false);
  });

  it("does not burn the code when the new password breaks the policy", async () => {
    // Checked after the code and before anything is written, so somebody who
    // picks a bad password gets to try again rather than starting over.
    await givePassword(COLLEGE);
    await requestPasswordReset(COLLEGE, deps);
    const code = delivered[0].code;

    expect((await resetPassword(COLLEGE, code, "short", deps)).ok).toBe(false);
    expect((await resetPassword(COLLEGE, code, "a whole new phrase", deps)).ok).toBe(true);
  });

  it("signs the account out everywhere", async () => {
    const store = authStore();
    const user = await givePassword(COLLEGE);
    await store.createSession({
      id: "session-before-reset",
      userId: user.id,
      createdAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + 3_600_000).toISOString(),
      lastSeenAt: clock.toISOString(),
      revokedAt: null,
    });

    await requestPasswordReset(COLLEGE, deps);
    await resetPassword(COLLEGE, delivered[0].code, "a whole new phrase", deps);
    expect((await store.findSession("session-before-reset"))?.revokedAt).not.toBeNull();
  });
});

describe("the seeded state", () => {
  it("puts colleges and employers on passwords and the board on codes", () => {
    const board = seed.organizations.find((o) => o.kind === "board")!;
    const college = seed.organizations.find((o) => o.kind === "college")!;
    expect(board.identityMode).toBe("email_code");
    expect(college.identityMode).toBe("password");
  });
});
