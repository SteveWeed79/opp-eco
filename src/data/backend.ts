/**
 * Which data layer the process is running on.
 *
 * One decision, made once, from one environment variable. Everything above
 * this file imports `repositories` and `store` from here and cannot tell the
 * difference — that is the whole point of the repository contracts, and the
 * reason the Postgres implementations were written against the same interfaces
 * rather than alongside them.
 *
 *   DATABASE_URL unset  in-memory fixtures, writes land in the seeded arrays
 *   DATABASE_URL set    Postgres, and read-only unless told otherwise
 *
 * The default is the in-memory store, and deliberately so: the demo, the unit
 * suite, and the end-to-end suite all depend on a process that boots with no
 * configuration at all and still has data in it.
 */

import { repositories as memoryRepositories } from "./memory";
import { memoryStore } from "./memory-store";
import type { Repositories } from "./repositories";
import type { Store } from "./store";
import { databaseConfig } from "./postgres/config";
import { postgresRepositories } from "./postgres/repositories";
import { postgresStore } from "./postgres/store";
import { postgresClient } from "./postgres/neon";

/**
 * Raised when a write is attempted against a read-only deployment.
 *
 * Carries a message meant for a person looking at the screen, because that is
 * where it ends up: every Server Action funnels failures into a toast, so this
 * has to explain itself rather than name a constraint.
 */
export class ReadOnlyError extends Error {
  constructor() {
    super(
      "This demonstration is running against a read-only database, so nothing can be changed. " +
        "Everything you see is real seeded data — browse freely.",
    );
    this.name = "ReadOnlyError";
  }
}

/**
 * Refuses every write, before a connection is taken.
 *
 * Wrapping the store rather than disabling buttons is deliberate. A disabled
 * button is a claim the UI makes and a direct POST ignores; this is the only
 * layer every write actually passes through, including a Server Action invoked
 * straight from a fetch. The guard runs before `work`, so no unit of work is
 * even assembled.
 */
export function readOnlyStore(): Store {
  return {
    async transaction<T>(): Promise<T> {
      throw new ReadOnlyError();
    },
  };
}

export interface Backend {
  repositories: Repositories;
  store: Store;
  /** True when reads come from Postgres rather than the fixtures. */
  usesDatabase: boolean;
  /** True when writes are refused. */
  readOnly: boolean;
}

function resolve(): Backend {
  const config = databaseConfig();

  if (!config.connectionString) {
    return {
      repositories: memoryRepositories,
      store: memoryStore,
      usesDatabase: false,
      readOnly: false,
    };
  }

  const client = postgresClient();
  return {
    repositories: postgresRepositories(client),
    store: config.readOnly ? readOnlyStore() : postgresStore(client),
    usesDatabase: true,
    readOnly: config.readOnly,
  };
}

/**
 * Resolved once per process.
 *
 * Lazily, because reading the config at module load would make importing this
 * file fail on a malformed `DATABASE_URL` — including inside tests that never
 * touch a database.
 */
let resolved: Backend | null = null;

export function backend(): Backend {
  if (!resolved) resolved = resolve();
  return resolved;
}

/** For tests that change the environment between cases. */
export function resetBackend(): void {
  resolved = null;
}

/**
 * The two things the rest of the application imports.
 *
 * Proxies rather than values, so the backend is resolved on first use instead
 * of at import time — which keeps a missing or malformed `DATABASE_URL` from
 * breaking modules that never read anything.
 */
export const repositories: Repositories = new Proxy({} as Repositories, {
  get: (_target, key) => backend().repositories[key as keyof Repositories],
});

export const store: Store = {
  transaction: (work) => backend().store.transaction(work),
};
