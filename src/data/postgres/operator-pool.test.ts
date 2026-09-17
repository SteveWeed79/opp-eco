/**
 * What an operator script's connection must never do.
 *
 * One line of config, and it looks like a tuning knob. It is not: with it wrong,
 * `npm run db:migrate` cannot apply a single file to a Neon database, and the
 * failure is invisible everywhere it is usually run.
 *
 * Neon's `poolQueryViaFetch` sends each `pool.query()` as a prepared statement
 * over one HTTP request, and a prepared statement holds exactly one command.
 * Every migration is dozens of commands spliced into a single BEGIN…COMMIT with
 * the ledger insert — so that "applied" and "recorded as applied" are the same
 * commit — and Neon answers:
 *
 *     cannot insert multiple commands into a prepared statement
 *
 * It survived this long because nothing exercised it. CI and every local run use
 * a container, which is the `pg` driver, where the setting does not exist. The
 * first person to migrate a Neon database hit it on file one.
 *
 * So the rule is asserted rather than commented: an operator script's pool takes
 * the session path regardless of how the application is tuned.
 */

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain JS operator script, which cannot import TypeScript
import { operatorConfig } from "../../../scripts/pool.mjs";

/** A config with every knob turned the way an operator script must override. */
const appConfig = {
  connectionString: "postgresql://user:pw@ep-x.region.aws.neon.tech/db",
  driver: "neon" as const,
  queryViaFetch: true,
  maxConnections: 10,
  defaultIsolation: "read committed" as const,
  maxRetries: 3,
  readOnly: true,
};

describe("the connection an operator script runs on", () => {
  it("never takes the HTTP path, whatever the environment says", () => {
    // The assertion this file exists for.
    expect(operatorConfig(appConfig).queryViaFetch).toBe(false);
  });

  it("stays off it even when the application is explicitly tuned onto it", () => {
    // `DATABASE_QUERY_VIA_FETCH` is there to tune the *application's* short
    // reads. A script running multi-statement DDL gains nothing from skipping a
    // handshake, and its correctness must not depend on that variable — which
    // is exactly what a working deployment would set to `true`.
    expect(operatorConfig({ ...appConfig, queryViaFetch: true }).queryViaFetch).toBe(false);
  });

  it("holds one connection by default", () => {
    // A migration running on a free tier should not hold several backends.
    expect(operatorConfig(appConfig).maxConnections).toBe(1);
    expect(operatorConfig(appConfig, 4).maxConnections).toBe(4);
  });

  it("changes nothing else about the application's configuration", () => {
    // The driver, the connection string and the retry policy are the
    // application's answer and must arrive untouched — a script that quietly
    // chose a different driver than the server would be a difference nobody
    // sees until it matters.
    const operator = operatorConfig(appConfig);
    expect(operator.connectionString).toBe(appConfig.connectionString);
    expect(operator.driver).toBe(appConfig.driver);
    expect(operator.defaultIsolation).toBe(appConfig.defaultIsolation);
    expect(operator.maxRetries).toBe(appConfig.maxRetries);
  });

  it("leaves the read-only flag alone, because it does not read it", () => {
    // Worth pinning rather than assuming. The scripts write through raw SQL and
    // never go through the Store, which is where `readOnly` is enforced — so
    // seeding a read-only deployment works, and that is deliberate.
    expect(operatorConfig(appConfig).readOnly).toBe(true);
  });
});
