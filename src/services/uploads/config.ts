/**
 * Which scanner the process has, and where the stub is not good enough.
 *
 * `stubScanner` detects the EICAR test string and nothing else. That is exactly
 * right for a demonstration of invented organisations — the quarantine path
 * gets exercised end to end without anybody running a virus daemon — and it is
 * a lie the moment a real learner attaches a real file, because every upload
 * comes back clean.
 *
 * So the stub is refused where the records are real, and the tell is the same
 * one `auth/config.ts` uses: a database is configured *and* writes are enabled.
 * Not `NODE_ENV`, which says nothing about whether the data matters — a
 * deployed demo is production and holds fixtures.
 *
 * The refusal is at the upload, not at boot. A missing scanner should stop
 * files being accepted; it should not stop the application starting, because a
 * deployment that will not boot gets the guard removed rather than the scanner
 * installed.
 */

import type { Scanner } from "./scanning";
import { stubScanner } from "./scanning";
import { CLAMAV_DEFAULTS, clamavScanner } from "./clamav";

export type ScannerMode = "stub" | "clamav";

export interface ScannerConfig {
  mode: ScannerMode;
  host: string;
  port: number;
}

export type ScannerEnv = Record<string, string | undefined>;

export function scannerConfig(env: ScannerEnv = process.env): ScannerConfig {
  const host = env.CLAMAV_HOST ?? "";
  const port = Number(env.CLAMAV_PORT ?? CLAMAV_DEFAULTS.port);

  return {
    // Presence of a host is the switch. There is no `SCANNER=clamav` to set
    // and then forget to point anywhere — a mode that needs a second variable
    // to mean anything is a mode that gets half-configured.
    mode: host ? "clamav" : "stub",
    host,
    port: Number.isSafeInteger(port) && port > 0 ? port : CLAMAV_DEFAULTS.port,
  };
}

export function configuredScanner(env: ScannerEnv = process.env): Scanner {
  const config = scannerConfig(env);
  return config.mode === "clamav"
    ? clamavScanner({ host: config.host, port: config.port })
    : stubScanner;
}

/**
 * Why this deployment must not accept uploads, or null when it may.
 *
 * Returns the sentence a person reads, because the alternative — a boolean the
 * caller turns into its own wording — is how two screens end up disagreeing
 * about why something was refused.
 */
export function uploadRefusalReason(env: ScannerEnv = process.env): string | null {
  const realRecords =
    Boolean(env.DATABASE_URL) && env.DATABASE_READ_ONLY === "false";

  if (realRecords && scannerConfig(env).mode === "stub") {
    return (
      "Uploads are turned off: this deployment holds real records and has no malware scanner. " +
      "Set CLAMAV_HOST to point at a clamd instance."
    );
  }
  return null;
}
