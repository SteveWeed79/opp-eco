/**
 * The connection the operator scripts open, and the environment behind it.
 *
 * Both scripts used to build a Neon pool directly, which quietly made Neon the
 * only database `npm run db:migrate` and `npm run db:seed` could reach — so a
 * local Postgres could not be migrated, and CI could not prove the schema
 * applies. The driver choice now comes from the same `databaseConfig` the app
 * resolves, imported rather than restated, because a script that picks a
 * different driver than the server is a difference nobody sees until it
 * matters.
 *
 * TypeScript is loaded through the alias hook, the same way `seed.mjs` imports
 * the fixtures: Node 22 strips the types, and the hook supplies the `@/*`
 * alias and the extensionless relative imports it does not know about.
 */

import { existsSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

register(pathToFileURL(join(ROOT, "scripts", "ts-alias-hook.mjs")));

/**
 * `.env.local` first, then `.env`, then whatever is already exported.
 *
 * A malformed file is ignored rather than fatal: an explicit `DATABASE_URL` in
 * the environment should still work past a stray line in a dotfile.
 */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const path = join(ROOT, file);
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path);
      } catch {
        // Ignored on purpose — see above.
      }
    }
  }
}

loadEnvFiles();

/**
 * The app's config and driver dispatch, loaded on first use.
 *
 * Dynamic rather than static for two reasons: a static import is hoisted, so
 * it would resolve before `register` above had run; and importing this module
 * must stay free, because `seed.mjs` is imported by a unit test that never
 * opens a connection and must not pull a driver in behind it.
 */
let loaded = null;
async function load() {
  if (!loaded) {
    const [config, pool] = await Promise.all([
      import(pathToFileURL(join(ROOT, "src/data/postgres/config.ts")).href),
      import(pathToFileURL(join(ROOT, "src/data/postgres/pool.ts")).href),
    ]);
    loaded = { databaseConfig: config.databaseConfig, poolFor: pool.poolFor };
  }
  return loaded;
}

/**
 * A pool, or a message explaining what to set.
 *
 * Exits rather than throws: this is the first thing a script does, and a stack
 * trace through a module hook is not what the reader needs to see.
 */
export async function connect({ max = 1 } = {}) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set.\n\n" +
        "  Neon:  create a project at https://console.neon.tech and copy the\n" +
        "         DIRECT connection string into .env.local\n" +
        "  Local: DATABASE_URL=postgresql://user:password@localhost:5432/oppeco\n",
    );
    process.exit(1);
  }

  const { databaseConfig, poolFor } = await load();
  const config = databaseConfig();
  // One connection is enough for a script that runs statements in sequence,
  // and it keeps a migration from holding several backends on a free tier.
  return poolFor({ ...config, maxConnections: max });
}

/** Which driver `connect` used, for scripts that report what they did. */
export async function driverName() {
  const { databaseConfig } = await load();
  return databaseConfig().driver;
}
