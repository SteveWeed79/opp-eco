/**
 * Which auth store the process is running on.
 *
 * Follows `DATABASE_URL` rather than `AUTH_MODE`: sessions belong wherever the
 * rest of the data is. Running real sign-on against the fixtures is a coherent
 * thing to do locally, and running the demo picker against a read-only database
 * is the shape of the deployed demonstration.
 */

import { databaseConfig } from "@/data/postgres/config";
import { postgresClient } from "@/data/postgres/pool";
import { memoryAuthStore } from "./memory-store";
import { postgresAuthStore } from "./postgres-store";
import type { AuthStore } from "./store";

function resolve(): AuthStore {
  const config = databaseConfig();
  if (!config.connectionString) return memoryAuthStore;
  return postgresAuthStore(postgresClient());
}

let resolved: AuthStore | null = null;

export function authStore(): AuthStore {
  resolved ??= resolve();
  return resolved;
}

/** Swap the store — used by tests. */
export function setAuthStore(next: AuthStore | null) {
  resolved = next;
}
