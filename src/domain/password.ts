/**
 * Password hashing and the policy around it.
 *
 * **scrypt, from `node:crypto`.** Argon2id is the current first choice and this
 * is not it; the reason is deployment rather than preference. Argon2 in Node
 * means a native module, and a native module means a build step that can fail
 * on a serverless platform in a way that takes sign-on down. scrypt is
 * memory-hard, is on OWASP's recommended list, and is already in the runtime.
 * The hash format below carries its parameters, so moving to Argon2id later is
 * a new prefix and a rehash-on-next-sign-in, not a migration that locks
 * everybody out.
 *
 * **The policy follows NIST 800-63B rather than habit.** Length is the control
 * that matters; composition rules are not. Requiring an uppercase, a digit and
 * a symbol reliably produces `Spring2026!` — it narrows the search space while
 * feeling strict, and it is why that guidance was withdrawn. What is here
 * instead: a real minimum length, a maximum so nobody can post a megabyte into
 * a KDF, and refusal of the handful of passwords that are obviously about this
 * person or this site.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Promisified by hand rather than with `promisify`, which drops the overload
 * that takes options — and the options are the entire point here.
 */
function scrypt(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Cost parameters.
 *
 * N=2^17, r=8, p=1 — OWASP's stated scrypt baseline, which works out at 128 MiB
 * and roughly 350 ms per hash on the machine this was measured on. That is the
 * point: slow for us once per sign-in, ruinous for somebody working through a
 * stolen table. `maxmem` has to be raised to match, because Node's default
 * ceiling is 32 MiB and scrypt refuses rather than quietly using less.
 *
 * Raised from 2^16, which was one notch below that baseline. It cost nothing to
 * do, because the parameters travel inside the stored hash: `needsRehash`
 * compares all three against these constants and `verifyPasswordSignIn`
 * re-hashes on the next successful sign-in, so every existing password moves up
 * as its owner uses it rather than in a migration that locks anybody out.
 *
 * **The memory is the thing to watch when raising this again.** 128 MiB is held
 * for the duration of each hash, and `verifyPasswordSignIn` deliberately hashes
 * even for an address that does not exist — otherwise the response time is the
 * directory the wording refuses to be. So concurrent sign-ins multiply this,
 * and on a small serverless instance the ceiling arrives sooner than the CPU
 * cost suggests. The sign-on rate limit is what bounds it.
 */
export const SCRYPT_N = 131072;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_BYTES = 32;
export const SCRYPT_SALT_BYTES = 16;

/** Minimum length. NIST says 8; this says more, because the ceiling is generous. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Maximum length.
 *
 * Not a security limit — a denial-of-service one. Without it, a request can
 * hand a memory-hard function a megabyte and make the server pay for it.
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Passwords refused outright.
 *
 * A gesture at the breach-list check NIST actually asks for, and named as such:
 * a real deployment checks against a corpus of known-compromised passwords,
 * which is a service call this does not make. What is here catches the ones
 * that would otherwise sail through a length check.
 */
const OBVIOUS = new Set([
  "password1234",
  "passwordpassword",
  "123456789012",
  "qwertyuiop12",
  "letmein12345",
  "iloveyou1234",
  "administrator",
  "welcome12345",
  "changeme1234",
  "opportunity1",
]);

export type PasswordProblem =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether a password may be set.
 *
 * Takes the address and the site name so it can refuse a password that is
 * simply one of those — the two guesses anybody makes first, and the two a
 * length rule cannot catch.
 */
export function checkPassword(
  password: string,
  context: { email?: string; siteName?: string } = {},
): PasswordProblem {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Use at least ${MIN_PASSWORD_LENGTH} characters. Length is what makes a password hard to guess — a long phrase beats a short one with symbols in it.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: `Keep it under ${MAX_PASSWORD_LENGTH} characters.` };
  }

  // Trimmed of nothing: leading and trailing spaces are part of a password and
  // silently stripping them makes one that works here fail elsewhere. But a
  // password that is *only* whitespace is somebody leaning on the spacebar.
  if (password.trim().length === 0) {
    return { ok: false, reason: "That is only spaces." };
  }

  const lower = password.toLowerCase();
  if (OBVIOUS.has(lower)) {
    return { ok: false, reason: "That is one of the first passwords anybody tries." };
  }

  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) {
    return { ok: false, reason: "Do not use your own address as your password." };
  }

  const site = context.siteName?.toLowerCase().replace(/\s+/g, "");
  if (site && site.length >= 4 && lower.replace(/\s+/g, "").includes(site)) {
    return { ok: false, reason: "Do not use this site's name as your password." };
  }

  return { ok: true };
}

/**
 * Hash a password.
 *
 * The result carries its own parameters — `scrypt$N$r$p$salt$key` — so a stored
 * hash can always be verified with the settings it was made with, and the cost
 * can be raised later without invalidating everybody at once.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Whether a password matches a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: this runs on the
 * sign-in path, and a row somebody mangled should refuse the sign-in, not
 * produce a stack trace with the hash in it.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, key] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(R) || !Number.isSafeInteger(P)) {
    return false;
  }
  // A stored hash naming absurd parameters is a hostile row, not a valid one:
  // honouring it would let a bad write turn every sign-in into a memory bomb.
  if (N > 1 << 20 || R > 32 || P > 16) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(key, "base64url");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64url"),
      expected.length,
      { N, r: R, p: P, maxmem: 256 * 1024 * 1024 },
    );
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether a stored hash was made with settings this build would still choose. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return (
    Number(parts[1]) !== SCRYPT_N ||
    Number(parts[2]) !== SCRYPT_R ||
    Number(parts[3]) !== SCRYPT_P
  );
}
