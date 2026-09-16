/**
 * Which file store the process is running on.
 *
 * Follows `DATABASE_URL`, the same switch that picks the repositories and the
 * auth store. Documents belong wherever the records they are attached to live;
 * a resume in Postgres and an application in a fixture array is a pairing that
 * can only produce orphans in one direction or the other.
 *
 * Note what this does **not** consult: `DATABASE_READ_ONLY`. That guard is
 * about the demonstration mutating records someone else is looking at, and an
 * upload is not a record — but a read-only deployment that accepts files is
 * still wrong, so `receiveUpload` refuses there rather than this file quietly
 * routing uploads somewhere they would not be found again.
 */

import { databaseConfig } from "@/data/postgres/config";
import { postgresClient } from "@/data/postgres/pool";
import { memoryFileStore } from "./storage";
import { postgresFileStore } from "./postgres-store";
import type { FileStore } from "./storage";

function resolve(): FileStore {
  const config = databaseConfig();
  if (!config.connectionString) return memoryFileStore;
  return postgresFileStore(postgresClient());
}

let resolved: FileStore | null = null;

export function fileStore(): FileStore {
  resolved ??= resolve();
  return resolved;
}

/** Swap the store — used by tests. */
export function setFileStore(next: FileStore | null) {
  resolved = next;
}
