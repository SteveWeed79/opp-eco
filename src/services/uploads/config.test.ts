import { describe, expect, it } from "vitest";
import { configuredScanner, scannerConfig, uploadRefusalReason } from "./config";
import { stubScanner } from "./scanning";

describe("picking a scanner", () => {
  it("is the stub with nothing configured, so a bare checkout still uploads", () => {
    expect(scannerConfig({}).mode).toBe("stub");
    expect(configuredScanner({})).toBe(stubScanner);
  });

  it("is clamd as soon as there is somewhere to send a file", () => {
    // A host is the whole switch. There is no separate mode flag to set and
    // then forget to point anywhere.
    const config = scannerConfig({ CLAMAV_HOST: "clamav.internal" });
    expect(config.mode).toBe("clamav");
    expect(config.port).toBe(3310);
    expect(configuredScanner({ CLAMAV_HOST: "clamav.internal" }).name).toContain(
      "clamav.internal:3310",
    );
  });

  it("takes a port when one is given", () => {
    expect(scannerConfig({ CLAMAV_HOST: "x", CLAMAV_PORT: "3311" }).port).toBe(3311);
  });

  it.each(["0", "-1", "not-a-port", "70000.5"])(
    "falls back to the default port rather than dialling %o",
    (port) => {
      expect(scannerConfig({ CLAMAV_HOST: "x", CLAMAV_PORT: port }).port).toBe(3310);
    },
  );
});

describe("whether this deployment may accept files at all", () => {
  it("allows the demo, where the stub is the honest choice", () => {
    expect(uploadRefusalReason({})).toBeNull();
  });

  it("allows a read-only database, which is the deployed demonstration", () => {
    expect(uploadRefusalReason({ DATABASE_URL: "postgres://x" })).toBeNull();
  });

  it("refuses real records behind a scanner that passes everything", () => {
    // The stub detects EICAR and nothing else. Against real files that is not
    // a weak scanner, it is no scanner with a reassuring name.
    const reason = uploadRefusalReason({
      DATABASE_URL: "postgres://x",
      DATABASE_READ_ONLY: "false",
    });
    expect(reason).toContain("no malware scanner");
    expect(reason).toContain("CLAMAV_HOST");
  });

  it("allows real records once a scanner is pointed at", () => {
    expect(
      uploadRefusalReason({
        DATABASE_URL: "postgres://x",
        DATABASE_READ_ONLY: "false",
        CLAMAV_HOST: "clamav.internal",
      }),
    ).toBeNull();
  });
});
