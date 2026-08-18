#!/usr/bin/env node
/**
 * Schema tooling.
 *
 * Plain JavaScript and standalone rather than part of the app: this runs
 * before the app can start, against a database the app is not yet wired to,
 * and it must work from a terminal with no build step in front of it.
 *
 *   npm run db:status    what is applied, what is pending
 *   npm run db:migrate   apply everything pending
 *   npm run db:verify    prove the connection and report what is there
 *
 * Reads DATABASE_URL from .env.local, then .env, then the ambient environment.
 * Use Neon's **direct** (non-pooled) connection string here — DDL through a
 * connection pooler can be refused or land on a different session than the one
 * holding the transaction.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { withLedgerInsert } from "./migrations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "src", "data", "postgres", "migrations");

for (const file of [".env.local", ".env"]) {
  const path = join(ROOT, file);
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
    } catch {
      // A malformed env file should not stop an explicit DATABASE_URL working.
    }
  }
}

const LEDGER = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`;

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const body = readFileSync(join(MIGRATIONS, name), "utf8");
      return {
        name,
        body,
        checksum: createHash("sha256").update(body).digest("hex").slice(0, 16),
      };
    });
}

function connect() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set.\n\n" +
        "  1. Create a project at https://console.neon.tech\n" +
        "  2. Copy the connection string (use the DIRECT one for migrations)\n" +
        "  3. Put it in .env.local as DATABASE_URL=postgresql://...\n",
    );
    process.exit(1);
  }
  if (!neonConfig.webSocketConstructor) {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }
  return new Pool({ connectionString, max: 1 });
}

async function appliedMigrations(pool) {
  await pool.query(LEDGER);
  const { rows } = await pool.query(
    "SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name",
  );
  return new Map(rows.map((r) => [r.name, r]));
}

async function status(pool) {
  const applied = await appliedMigrations(pool);
  const files = migrationFiles();
  let pending = 0;
  let drifted = 0;

  for (const file of files) {
    const record = applied.get(file.name);
    if (!record) {
      pending++;
      console.log(`  pending  ${file.name}`);
    } else if (record.checksum !== file.checksum) {
      drifted++;
      // An applied migration whose text changed means the database and the
      // repository disagree about what the schema is. Editing an applied
      // migration is the cause; a new migration is the fix.
      console.log(`  CHANGED  ${file.name}  (applied ${record.checksum}, file ${file.checksum})`);
    } else {
      console.log(`  applied  ${file.name}`);
    }
  }

  console.log(
    `\n${files.length} migration(s): ${files.length - pending} applied, ${pending} pending` +
      (drifted ? `, ${drifted} CHANGED SINCE APPLYING` : ""),
  );
  return { pending, drifted };
}

async function migrate(pool) {
  const applied = await appliedMigrations(pool);
  const files = migrationFiles();
  let ran = 0;

  for (const file of files) {
    const record = applied.get(file.name);
    if (record) {
      if (record.checksum !== file.checksum) {
        console.error(
          `\n${file.name} was applied as ${record.checksum} but is now ${file.checksum}.\n` +
            "Editing an applied migration leaves the database and the repository\n" +
            "disagreeing. Write a new migration instead.",
        );
        process.exit(1);
      }
      continue;
    }
    process.stdout.write(`  applying ${file.name} … `);
    await pool.query(withLedgerInsert(file));
    console.log("ok");
    ran++;
  }

  console.log(ran === 0 ? "\nNothing to apply." : `\nApplied ${ran} migration(s).`);
}

async function verify(pool) {
  const { rows: version } = await pool.query("SELECT version()");
  console.log(`connected: ${String(version[0].version).split(",")[0]}`);

  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(
    tables.length === 0
      ? "tables:    none — run `npm run db:migrate`"
      : `tables:    ${tables.length} (${tables.map((t) => t.table_name).join(", ")})`,
  );

  // Proves the round trip the app actually depends on: a parameterised query
  // and an interactive transaction that rolls back cleanly.
  const { rows: echo } = await pool.query("SELECT $1::text AS value", ["ok"]);
  console.log(`parameters: ${echo[0].value}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT 1");
    await client.query("ROLLBACK");
    console.log("transactions: serializable begin/rollback ok");
  } finally {
    client.release();
  }
}

const COMMANDS = { status, migrate, verify };

const command = process.argv[2] ?? "status";
if (!(command in COMMANDS)) {
  console.error(`Unknown command "${command}". Expected one of: ${Object.keys(COMMANDS).join(", ")}`);
  process.exit(1);
}

const pool = connect();
try {
  await COMMANDS[command](pool);
} catch (error) {
  console.error(`\n${command} failed:`, error.message ?? error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
