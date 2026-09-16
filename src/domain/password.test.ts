import { describe, expect, it } from "vitest";
import {
  checkPassword,
  hashPassword,
  needsRehash,
  verifyPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SCRYPT_N,
} from "./password";

/**
 * Password hashing.
 *
 * Deliberately slow — each hash is tens to hundreds of milliseconds, which is
 * the property being bought — so these use few cases and say why, rather than
 * sweeping. A fast password test is a test of something that is not a password
 * hash.
 */

describe("hashing", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("refuses the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapler", stored)).toBe(false);
  });

  it("salts, so the same password twice is two different hashes", async () => {
    // Without this, a stolen table tells an attacker which accounts share a
    // password — and cracking one cracks all of them.
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery staple", b)).toBe(true);
  });

  it("carries its own parameters, so the cost can be raised later", async () => {
    // `scrypt$N$r$p$salt$key`. A stored hash stays verifiable with the settings
    // it was made with, which is what stops a cost increase locking everybody
    // out at once.
    const stored = await hashPassword("correct horse battery staple");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBe(SCRYPT_N);
  });

  it("normalises, so the same characters typed two ways still match", async () => {
    // Composed and decomposed "é" are different bytes and the same password to
    // the person typing it on a different keyboard.
    const stored = await hashPassword("café au lait forever");
    expect(await verifyPassword("café au lait forever", stored)).toBe(true);
  });

  it("keeps leading and trailing spaces, because they are part of it", async () => {
    // Silently trimming makes a password that works here fail in a manager
    // that does not trim.
    const stored = await hashPassword("  a passphrase with space  ");
    expect(await verifyPassword("a passphrase with space", stored)).toBe(false);
    expect(await verifyPassword("  a passphrase with space  ", stored)).toBe(true);
  });
});

describe("a stored hash that is not one", () => {
  it.each([
    ["empty", ""],
    ["not the format", "hunter2"],
    ["the wrong algorithm", "bcrypt$65536$8$1$c2FsdA$a2V5"],
    ["too few parts", "scrypt$65536$8$1$c2FsdA"],
    ["parameters that are not numbers", "scrypt$N$r$p$c2FsdA$a2V5"],
    ["an empty key", "scrypt$65536$8$1$c2FsdA$"],
  ])("refuses %s rather than throwing", async (_why, stored) => {
    // This runs on the sign-in path. A mangled row should refuse the sign-in,
    // not produce a stack trace with the hash in it.
    await expect(verifyPassword("anything at all", stored)).resolves.toBe(false);
  });

  it("refuses absurd parameters instead of honouring them", async () => {
    // A hostile row naming N=2^30 would turn every attempt against that account
    // into a memory bomb. Bounded rather than trusted.
    await expect(
      verifyPassword("anything at all", "scrypt$1073741824$8$1$c2FsdA$a2V5"),
    ).resolves.toBe(false);
  });
});

describe("the policy", () => {
  it("accepts a long passphrase with no symbols in it", () => {
    // The point of following NIST rather than habit: length is the control,
    // and composition rules reliably produce `Spring2026!`.
    expect(checkPassword("the quiet kansas afternoon").ok).toBe(true);
  });

  it.each([
    ["short", "short"],
    ["eleven chars", "elevenchars"],
  ])("refuses %o", (_why, password) => {
    expect(checkPassword(password).ok).toBe(false);
  });

  it("accepts exactly the minimum", () => {
    expect(checkPassword("a".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it("caps the length, because a KDF is a denial-of-service target", () => {
    expect(checkPassword("a".repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false);
  });

  it("refuses the passwords everybody tries first, whatever the case", () => {
    expect(checkPassword("password1234").ok).toBe(false);
    expect(checkPassword("Password1234").ok).toBe(false);
  });

  it("refuses somebody's own address", () => {
    const result = checkPassword("evance-verdigris-2026", { email: "evance@x.edu" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/your own address/i);
  });

  it("refuses the site's own name", () => {
    expect(
      checkPassword("career connected learning", { siteName: "Career Connected" }).ok,
    ).toBe(false);
  });

  it("refuses a password of only spaces", () => {
    expect(checkPassword(" ".repeat(20)).ok).toBe(false);
  });

  it("explains itself in terms somebody can act on", () => {
    const result = checkPassword("short");
    expect(result.ok).toBe(false);
    // Says what actually helps rather than demanding a symbol.
    if (!result.ok) expect(result.reason).toMatch(/long phrase/i);
  });
});

describe("rehashing", () => {
  it("leaves a current hash alone", async () => {
    expect(needsRehash(await hashPassword("the quiet kansas afternoon"))).toBe(false);
  });

  it("flags one made with weaker settings", () => {
    // How a cost increase rolls out: the next successful sign-in rehashes.
    expect(needsRehash("scrypt$16384$8$1$c2FsdA$a2V5")).toBe(true);
  });

  it("flags anything that is not scrypt at all", () => {
    // Including a hash this build no longer recognises, which is how a move to
    // Argon2id would roll out without locking anybody out.
    expect(needsRehash("argon2id$v=19$m=65536,t=3,p=4$c2FsdA$a2V5")).toBe(true);
  });
});
