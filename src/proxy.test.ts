import { describe, expect, it } from "vitest";
import { newRequestId, sanitiseRequestId, REQUEST_ID_HEADER } from "./proxy";

/**
 * Request correlation.
 *
 * The id is not a secret and guards nothing — it exists so that "it broke when
 * I clicked authorize" becomes one search. Which means the properties that
 * matter are the unglamorous ones: it has to survive being read aloud, it has
 * to not be replaced when something upstream already minted one, and it has to
 * not be a way to write arbitrary text into a log line.
 */

describe("minting one", () => {
  it("is short enough to read down a phone line", () => {
    // A UUID is 36 characters with hyphens, which people transcribe wrongly.
    expect(newRequestId()).toHaveLength(8);
  });

  it("uses no character that can be confused for another", () => {
    // No 0/O, no 1/I/L. Somebody is going to type this from a screenshot.
    const ids = Array.from({ length: 200 }, newRequestId).join("");
    expect(ids).not.toMatch(/[01OIL]/);
    expect(ids).toMatch(/^[A-Z2-9]+$/);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 500 }, newRequestId));
    expect(ids.size).toBe(500);
  });
});

describe("accepting one from upstream", () => {
  it("keeps an id the platform already set", () => {
    // Two ids for one request is worse than none: each looks authoritative in
    // a different system, and the two never join up.
    expect(sanitiseRequestId("req_01H8XYZ-abc.123")).toBe("req_01H8XYZ-abc.123");
  });

  it("trims, because a header with whitespace is still the same id", () => {
    expect(sanitiseRequestId("  ABC123  ")).toBe("ABC123");
  });

  it("refuses nothing at all", () => {
    expect(sanitiseRequestId(null)).toBeNull();
    expect(sanitiseRequestId("")).toBeNull();
    expect(sanitiseRequestId("   ")).toBeNull();
  });

  it.each([
    ["a newline, which would forge a second log line", "abc\ndef"],
    ["a carriage return, same trick", "abc\r\nlevel=info"],
    ["quotes and braces, which would break out of a JSON field", 'abc","level":"error'],
    ["a space", "abc def"],
    ["something far too long", "a".repeat(65)],
  ])("refuses %s", (_why, value) => {
    // Refused rather than escaped: this value is attacker-controlled and ends
    // up in a log line and a response header, and the safe move for a field
    // that should be an opaque token is to mint a fresh one instead.
    expect(sanitiseRequestId(value)).toBeNull();
  });
});

describe("the header name", () => {
  it("is the one every platform already uses", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});
