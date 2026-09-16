/**
 * Time-based one-time passwords, per RFC 6238.
 *
 * Implemented here rather than taken from a package, for the same reason clamd
 * is spoken directly: this is ninety lines of well-specified arithmetic sitting
 * on the second factor for the account that can read every market. A dependency
 * here is a dependency with a view of everybody's records, and the published
 * test vectors mean the implementation can be checked against the specification
 * instead of against itself.
 *
 * Deliberately pure. No clock, no storage, no randomness — every one of those
 * is passed in, which is what lets `totp.test.ts` run the RFC's own vectors at
 * the exact timestamps they are specified for.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** RFC 4648 base32, which is what every authenticator app expects. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/**
 * How far either side of now a code is accepted.
 *
 * One step, which is thirty seconds each way. Phones drift and people finish
 * typing after the digits change; zero tolerance produces support tickets, and
 * a wide window is just a longer-lived password. One step is the number every
 * reference implementation settles on.
 */
export const TOTP_WINDOW_STEPS = 1;

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  // No padding. Authenticator apps accept it either way and a secret people
  // sometimes type by hand is better without trailing `=`.
  return out;
}

export function decodeBase32(secret: string): Uint8Array {
  // Case-insensitive, and spaces are stripped: the secret is displayed in
  // groups of four for anyone typing it in, and they will type the spaces.
  const cleaned = secret.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("That is not a base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * The counter for a moment in time.
 *
 * Exported because a test that recomputes this is a test that agrees with
 * itself; the RFC's vectors are given as timestamps, and this is what turns
 * them into the counter the algorithm actually hashes.
 */
export function counterFor(at: Date, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(at.getTime() / 1000 / period);
}

/** One code, for one counter. HMAC-SHA1 is what RFC 6238 specifies. */
export function codeForCounter(
  secret: Uint8Array,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  // Eight-byte big-endian counter. Written through a DataView rather than by
  // shifting, because the counter exceeds 32 bits in the year 6053 and a
  // bit-shift would silently wrap.
  const message = Buffer.alloc(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter), false);

  const digest = createHmac("sha1", Buffer.from(secret)).update(message).digest();

  // Dynamic truncation, straight from the RFC: the low nibble of the last byte
  // picks the offset, and the top bit of the extracted word is masked off so
  // the result is the same on every platform's signed arithmetic.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The code for a moment, which is the one an app is showing right now. */
export function codeFor(secret: Uint8Array, at: Date): string {
  return codeForCounter(secret, counterFor(at));
}

/**
 * Whether a presented code is right for this moment.
 *
 * Compared in constant time across the whole window rather than returning on
 * the first match: an early return leaks which step matched, which is a small
 * leak about the verifier's clock offset and free to avoid.
 */
export function verifyTotp(
  secret: Uint8Array,
  presented: string,
  at: Date,
  windowSteps = TOTP_WINDOW_STEPS,
): boolean {
  const cleaned = presented.replace(/\s/g, "");
  if (!/^\d+$/.test(cleaned) || cleaned.length !== TOTP_DIGITS) return false;

  const now = counterFor(at);
  let matched = false;
  for (let step = -windowSteps; step <= windowSteps; step++) {
    const candidate = codeForCounter(secret, now + step);
    const equal = timingSafeEqual(
      Buffer.from(candidate, "utf8"),
      Buffer.from(cleaned, "utf8"),
    );
    matched = matched || equal;
  }
  return matched;
}

/**
 * The URI an authenticator app reads.
 *
 * The issuer appears twice — as a prefix on the label and as a parameter —
 * which looks redundant and is what the de-facto spec requires: older apps read
 * one and newer ones read the other, and an account that shows up as a bare
 * email address in a list of thirty is one nobody can identify later.
 */
export function otpauthUri(params: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Grouped in fours, for the person typing it in because the camera failed. */
export function readableSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
