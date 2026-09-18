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
import { memoryNotificationQueue, memoryStore } from "./memory-store";
import type { Repositories } from "./repositories";
import type { NotificationQueue, Store } from "./store";
import { isDemonstrationVisitor } from "@/auth/visitor";
import { withVisitorOverlay } from "@/demo/repositories";
import { databaseConfig } from "./postgres/config";
import { postgresRepositories } from "./postgres/repositories";
import { postgresStore } from "./postgres/store";
import {
  postgresNotificationQueue,
  readOnlyNotificationQueue,
} from "./postgres/outbox";
import { postgresClient } from "./postgres/pool";

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
 * Refused because nobody is signed in.
 *
 * Its own message rather than `ReadOnlyError`'s, because the two are different
 * facts and a visitor deserves the one that is true of them: the deployment is
 * writable, they simply are not the one writing.
 */
export class VisitorError extends Error {
  constructor() {
    super(
      "You are browsing the demonstration as a visitor, so nothing you do here is saved. " +
        "Sign in to work in the product.",
    );
    this.name = "VisitorError";
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
  /**
   * Where committed transactions leave their notifications.
   *
   * Resolved here with everything else, because it belongs to the data layer:
   * the fixtures queue in an array, Postgres in `notification_outbox`. The
   * dispatcher used to import the array directly, which on a database
   * deployment left every message written and none sent.
   */
  notifications: NotificationQueue;
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
      notifications: memoryNotificationQueue,
      usesDatabase: false,
      readOnly: false,
    };
  }

  const client = postgresClient();
  return {
    repositories: postgresRepositories(client),
    store: config.readOnly ? readOnlyStore() : postgresStore(client),
    notifications: config.readOnly
      ? readOnlyNotificationQueue(client)
      : postgresNotificationQueue(client),
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
/**
 * Wrapped once, here, so every reader gets the same view.
 *
 * The overlay is a no-op for everybody but an anonymous visitor walking the
 * demonstration — `isAnonymousVisitor` is false for a signed-in person and
 * false outside a request altogether, so the unit suite and every real session
 * read straight through. See `src/demo/repositories.ts`.
 */
const withOverlay = (base: Repositories) => withVisitorOverlay(base);

export const repositories: Repositories = new Proxy({} as Repositories, {
  get: (_target, key) => withOverlay(backend().repositories)[key as keyof Repositories],
});

/**
 * Every write in the application, and the two things that can refuse one.
 *
 * A read-only deployment is refused by the store `backend()` hands back. A
 * visitor with no session is refused here, and the check is a session's
 * presence rather than anything about the actor: a signed-out caller reaching
 * a portal is handed the demonstration's own account so the prototype stays
 * walkable from a bare link, and that account is a working actor. Reads are
 * exactly what it is for. Writes are not — on a deployment that authenticates,
 * they would be anonymous writes to a production database.
 *
 * Here rather than in the actions, for the reason `readOnlyStore` gives: this
 * is the only layer every write actually passes through, including a Server
 * Action invoked straight from a fetch. Eleven action files each remembering
 * to call a guard is eleven chances to forget.
 *
 * The import is dynamic because `auth/session` reads this module back; it is
 * the same shape `session.ts` already uses to reach the data layer.
 */
export const store: Store = {
  // `async` so this rejects rather than throwing synchronously, which is what
  // `readOnlyStore` does and what a caller reaching for `.catch()` without an
  // `await` expects. The two refusals should not behave differently.
  transaction: async (work) => {
    if (await isDemonstrationVisitor()) throw new VisitorError();
    return backend().store.transaction(work);
  },
};

/** The queue the dispatcher drains, whichever data layer filled it. */
export const notificationQueue: NotificationQueue = {
  take: () => backend().notifications.take(),
  requeue: (item, error) => backend().notifications.requeue(item, error),
  pending: (marketId) => backend().notifications.pending(marketId),
};
