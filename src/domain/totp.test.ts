import { describe, expect, it } from "vitest";
import {
  codeForCounter,
  counterFor,
  decodeBase32,
  encodeBase32,
  otpauthUri,
  readableSecret,
  verifyTotp,
  TOTP_PERIOD_SECONDS,
} from "./totp";

/**
 * Checked against RFC 4226 and RFC 6238, not against itself.
 *
 * The whole reason this is hand-written rather than imported is that it sits on
 * the second factor for the account that can read every market. That is only
 * worth doing if it is verified against the specification, so these are the
 * published vectors: a test that recomputed the expected values with the same
 * code would pass on any consistent implementation, including a wrong one.
 */

/** RFC 4226 Appendix D: the secret is the ASCII string "12345678901234567890". */
const HOTP_SECRET = new Uint8Array(Buffer.from("12345678901234567890", "ascii"));

describe("RFC 4226 test vectors", () => {
  it.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ])("counter %i produces %s", (counter, expected) => {
    expect(codeForCounter(HOTP_SECRET, counter)).toBe(expected);
  });
});

describe("RFC 6238 test vectors", () => {
  // The RFC's SHA-1 column. Its 8-digit values are truncated to the six this
  // implementation uses, which is the same arithmetic modulo a smaller power
  // of ten — so the low six digits are what a 6-digit authenticator shows.
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("time %i produces %s", (seconds, eightDigits) => {
    const at = new Date(seconds * 1000);
    expect(codeForCounter(HOTP_SECRET, counterFor(at))).toBe(eightDigits.slice(-6));
  });

  it("derives the counter the way the RFC specifies", () => {
    // T = floor((unix time) / 30). Asserted directly because every vector above
    // depends on it, and an off-by-one here would still look self-consistent.
    expect(counterFor(new Date(59_000))).toBe(1);
    expect(counterFor(new Date(60_000))).toBe(2);
    expect(counterFor(new Date(1111111109_000))).toBe(0x23523ec);
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (let length = 1; length <= 40; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + length) % 256);
      expect([...decodeBase32(encodeBase32(bytes))]).toEqual([...bytes]);
    }
  });

  it("matches RFC 4648 for the known strings", () => {
    const of = (text: string) => encodeBase32(new Uint8Array(Buffer.from(text)));
    // Padding is omitted deliberately, so these are the RFC's values with the
    // trailing `=` removed.
    expect(of("f")).toBe("MY");
    expect(of("fo")).toBe("MZXQ");
    expect(of("foo")).toBe("MZXW6");
    expect(of("foob")).toBe("MZXW6YQ");
    expect(of("fooba")).toBe("MZXW6YTB");
    expect(of("foobar")).toBe("MZXW6YTBOI");
  });

  it("accepts a secret typed back in with its display spacing", () => {
    // It is shown in groups of four for whoever is typing it by hand, and they
    // will type the spaces.
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const shown = readableSecret(encodeBase32(bytes));
    expect(shown).toContain(" ");
    expect([...decodeBase32(shown)]).toEqual([...bytes]);
  });

  it("accepts lower case, because people retype what they see", () => {
    expect([...decodeBase32("mzxw6ytboi")]).toEqual([
      ...new Uint8Array(Buffer.from("foobar")),
    ]);
  });

  it("refuses something that is not base32 rather than guessing", () => {
    expect(() => decodeBase32("not-a-secret!")).toThrow();
  });
});

describe("verifying a presented code", () => {
  const at = new Date(1111111109 * 1000);

  it("accepts the code for this moment", () => {
    expect(verifyTotp(HOTP_SECRET, "081804", at)).toBe(true);
  });

  it("accepts one step either side, because clocks drift", () => {
    const early = new Date(at.getTime() - TOTP_PERIOD_SECONDS * 1000);
    const late = new Date(at.getTime() + TOTP_PERIOD_SECONDS * 1000);
    expect(verifyTotp(HOTP_SECRET, "081804", early)).toBe(true);
    expect(verifyTotp(HOTP_SECRET, "081804", late)).toBe(true);
  });

  it("refuses two steps out, because a wide window is a long-lived password", () => {
    const tooLate = new Date(at.getTime() + 2 * TOTP_PERIOD_SECONDS * 1000 + 1000);
    expect(verifyTotp(HOTP_SECRET, "081804", tooLate)).toBe(false);
  });

  it("refuses the wrong code", () => {
    expect(verifyTotp(HOTP_SECRET, "000000", at)).toBe(false);
  });

  it.each(["", "12345", "1234567", "abcdef", "12 34 56", "0x1234"])(
    "refuses %o without hashing anything",
    (presented) => {
      expect(verifyTotp(HOTP_SECRET, presented, at)).toBe(false);
    },
  );

  it("tolerates the spacing an app displays", () => {
    expect(verifyTotp(HOTP_SECRET, "081 804", at)).toBe(true);
  });
});

describe("the enrolment URI", () => {
  it("names the issuer twice, which is what apps actually read", () => {
    const uri = otpauthUri({
      issuer: "CCLN",
      account: "sweed@example.org",
      secret: "MZXW6YTBOI",
    });
    // Once in the label, so the account is identifiable in a list of thirty,
    // and once as a parameter, because older and newer apps read different ones.
    expect(uri).toContain("otpauth://totp/CCLN%3Asweed%40example.org");
    expect(uri).toContain("issuer=CCLN");
    expect(uri).toContain("secret=MZXW6YTBOI");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
