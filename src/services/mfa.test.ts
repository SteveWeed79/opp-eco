import { describe, it, expect, beforeEach } from "vitest";
import {
  answerChallenge,
  beginEnrolment,
  confirmEnrolment,
  issueChallenge,
  mfaStatus,
  removeEnrolment,
} from "./mfa";
import { completeChallenge, requestSignInCode, verifySignInCode } from "./auth";
import type { SignInDeps } from "./auth";
import { authStore } from "@/auth/backend";
import { resetAuthState } from "@/auth/memory-store";
import { codeFor, decodeBase32 } from "@/domain/totp";
import { MFA_CHALLENGE_TTL_MS, MFA_MAX_ATTEMPTS } from "@/domain/identity";
import { contextFor } from "@/data/session";
import { brandAddress } from "@/brand";

/**
 * The second factor.
 *
 * The assertions that matter are the ones about what a challenge is *not*: it
 * is not a session, it does not resolve to an actor, and answering it wrongly
 * does not leave anything behind that could be used instead.
 */

let clock = new Date("2026-06-01T12:00:00.000Z");
const deps = { now: () => clock };
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const admin = () => contextFor("admin");

beforeEach(() => {
  resetAuthState();
  clock = new Date("2026-06-01T12:00:00.000Z");
});

/** Enrol, and hand back the secret so a test can compute real codes. */
async function enrol() {
  const offer = await beginEnrolment(admin(), deps);
  if (!offer.ok) throw new Error(offer.error);
  const stored = (await authStore().findTotpEnrolment(admin().user.id))!;
  const secret = decodeBase32(stored.secret);
  const confirmed = await confirmEnrolment(admin(), codeFor(secret, clock), deps);
  if (!confirmed.ok) throw new Error(confirmed.error);

  // Past the counter that confirming just consumed. Enrolling records the code
  // it accepted, so re-presenting it is a replay and is refused — correctly,
  // and not something a test should have to work around by pretending sign-in
  // happens in the same thirty seconds as enrolment.
  advance(60_000);
  return { secret, recoveryCodes: confirmed.recoveryCodes, offer: offer.offer };
}

describe("enrolling", () => {
  it("offers a secret and a URI an app can read", async () => {
    const result = await beginEnrolment(admin(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offer.uri).toContain("otpauth://totp/");
    // Grouped in fours for whoever is typing it in because the camera failed.
    expect(result.offer.secret).toContain(" ");
  });

  it("is not in force until a code from it is proved", async () => {
    await beginEnrolment(admin(), deps);
    // An unconfirmed enrolment that already counted would be a way to lock
    // somebody out of their own account by starting a setup and walking away.
    expect((await mfaStatus(admin())).enrolled).toBe(false);
  });

  it("refuses the wrong code, and stays unconfirmed", async () => {
    await beginEnrolment(admin(), deps);
    const result = await confirmEnrolment(admin(), "000000", deps);
    expect(result.ok).toBe(false);
    expect((await mfaStatus(admin())).enrolled).toBe(false);
  });

  it("issues recovery codes exactly once", async () => {
    const { recoveryCodes } = await enrol();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    // Stored as hashes, so there is no path by which they could be shown again.
    const stored = await authStore().unusedRecoveryCodes(admin().user.id);
    expect(stored).toHaveLength(10);
    for (const code of stored) expect(recoveryCodes).not.toContain(code.codeHash);
  });

  it("will not silently replace a confirmed enrolment", async () => {
    // Swapping somebody's authenticator out from under them is a takeover, not
    // a convenience.
    await enrol();
    const again = await beginEnrolment(admin(), deps);
    expect(again.ok).toBe(false);
  });

  it("takes the recovery codes away with the enrolment", async () => {
    await enrol();
    await removeEnrolment(admin());
    expect((await mfaStatus(admin())).enrolled).toBe(false);
    expect(await authStore().unusedRecoveryCodes(admin().user.id)).toHaveLength(0);
  });
});

describe("a challenge", () => {
  it("is not a session", async () => {
    // The property the whole design rests on. `resolveSessionToken` knows
    // nothing about a challenge token, so presenting one as a session resolves
    // to nobody.
    const { resolveSessionToken } = await import("./auth");
    await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    expect(await resolveSessionToken(challenge.token, deps as SignInDeps)).toBeNull();
  });

  it("accepts the code the app is showing", async () => {
    const { secret } = await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    const result = await answerChallenge(challenge.token, codeFor(secret, clock), deps);
    expect(result.ok).toBe(true);
  });

  it("refuses the same code twice", async () => {
    // The window accepts a step either side, so a code read over a shoulder
    // stays valid for up to ninety seconds. Recording the counter closes that.
    const { secret } = await enrol();
    const code = codeFor(secret, clock);

    const first = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(first.token, code, deps)).ok).toBe(true);

    const second = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(second.token, code, deps)).ok).toBe(false);
  });

  it("accepts the next code after one has been used", async () => {
    const { secret } = await enrol();
    const first = await issueChallenge(admin().user.id, deps);
    await answerChallenge(first.token, codeFor(secret, clock), deps);

    advance(60_000);
    const second = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(second.token, codeFor(secret, clock), deps)).ok).toBe(
      true,
    );
  });

  it("expires", async () => {
    const { secret } = await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    advance(MFA_CHALLENGE_TTL_MS + 1000);
    const result = await answerChallenge(challenge.token, codeFor(secret, clock), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/took too long/i);
  });

  it("dies after a handful of wrong guesses, even if the right one follows", async () => {
    const { secret } = await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) {
      await answerChallenge(challenge.token, "000000", deps);
    }
    expect((await answerChallenge(challenge.token, codeFor(secret, clock), deps)).ok).toBe(
      false,
    );
  });

  it("is spent once answered", async () => {
    const { secret } = await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    const code = codeFor(secret, clock);
    expect((await answerChallenge(challenge.token, code, deps)).ok).toBe(true);
    // Replaying the challenge itself gets nowhere either.
    expect((await answerChallenge(challenge.token, code, deps)).ok).toBe(false);
  });

  it("refuses a token nobody issued", async () => {
    expect((await answerChallenge("not-a-real-token", "000000", deps)).ok).toBe(false);
  });
});

describe("recovery codes", () => {
  it("get somebody in when the phone is gone", async () => {
    const { recoveryCodes } = await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(challenge.token, recoveryCodes[0], deps)).ok).toBe(true);
  });

  it("work once each", async () => {
    const { recoveryCodes } = await enrol();
    const first = await issueChallenge(admin().user.id, deps);
    await answerChallenge(first.token, recoveryCodes[0], deps);

    const second = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(second.token, recoveryCodes[0], deps)).ok).toBe(false);
    // A different one still works, so using one is not losing them all.
    const third = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(third.token, recoveryCodes[1], deps)).ok).toBe(true);
  });

  it("are counted down where somebody can see it", async () => {
    const { recoveryCodes } = await enrol();
    expect((await mfaStatus(admin())).recoveryCodesLeft).toBe(10);
    const challenge = await issueChallenge(admin().user.id, deps);
    await answerChallenge(challenge.token, recoveryCodes[0], deps);
    expect((await mfaStatus(admin())).recoveryCodesLeft).toBe(9);
  });

  it("tolerate the spacing and case somebody reads off a printout", async () => {
    const { recoveryCodes } = await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    const typed = recoveryCodes[0].toLowerCase().replace(/(.{4})/, "$1 ");
    expect((await answerChallenge(challenge.token, typed, deps)).ok).toBe(true);
  });

  it("refuse one that was never issued", async () => {
    await enrol();
    const challenge = await issueChallenge(admin().user.id, deps);
    expect((await answerChallenge(challenge.token, "ZZZZZZZZZZ", deps)).ok).toBe(false);
  });
});

describe("signing in with a second factor in force", () => {
  // Built from the brand rather than written out: `brand.test.ts` refuses a
  // hardcoded product domain, and it is right to.
  const ADMIN_EMAIL = brandAddress("admin");
  let delivered: { to: string; code: string }[] = [];

  const signInDeps: SignInDeps = {
    now: () => clock,
    async deliver(to, code) {
      delivered.push({ to, code });
    },
  };

  beforeEach(() => {
    delivered = [];
  });

  it("stops at a challenge rather than handing out a session", async () => {
    const { secret } = await enrol();

    await requestSignInCode(ADMIN_EMAIL, signInDeps);
    const verified = await verifySignInCode(
      ADMIN_EMAIL,
      delivered.at(-1)!.code,
      signInDeps,
    );
    // Not `true`: the first factor passed and the second is owed.
    expect(verified.ok).toBe("challenge");
    if (verified.ok !== "challenge") return;

    const finished = await completeChallenge(
      verified.challenge,
      codeFor(secret, clock),
      signInDeps,
    );
    expect(finished.ok).toBe(true);
    if (finished.ok !== true) return;
    expect(finished.actor.membership.role).toBe("admin");
  });

  it("hands out no session when the second factor is wrong", async () => {
    await enrol();
    await requestSignInCode(ADMIN_EMAIL, signInDeps);
    const verified = await verifySignInCode(
      ADMIN_EMAIL,
      delivered.at(-1)!.code,
      signInDeps,
    );
    if (verified.ok !== "challenge") throw new Error("expected a challenge");

    const finished = await completeChallenge(verified.challenge, "000000", signInDeps);
    expect(finished.ok).toBe(false);
  });

  it("does not challenge somebody who has not enrolled", async () => {
    // Enrolling is the act of asking to be challenged. Somebody who has not is
    // signed in as before, which is what keeps a fresh deployment reachable.
    await requestSignInCode(ADMIN_EMAIL, signInDeps);
    const verified = await verifySignInCode(
      ADMIN_EMAIL,
      delivered.at(-1)!.code,
      signInDeps,
    );
    expect(verified.ok).toBe(true);
  });
});
