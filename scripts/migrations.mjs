/**
 * Pure helpers for the migration runner.
 *
 * Separated from `db.mjs` so they can be tested without a database and without
 * running the CLI — `db.mjs` connects and executes at import time, which is
 * the right shape for a script and the wrong one for a test.
 */

/**
 * Strip leading SQL comments and blank lines.
 *
 * Both migrations in this repository open with a paragraph of `--` comments
 * explaining the schema, so a naive `startsWith("BEGIN")` reports that they
 * manage no transaction — and the runner then wraps an already-transactional
 * file in a second BEGIN/COMMIT. That nests a transaction, and worse, leaves
 * the ledger insert stranded after the file's own COMMIT where a failure can
 * no longer roll it back.
 */
export function stripLeadingComments(text) {
  return text.replace(/^(?:\s*--[^\n]*\n|\s*\n)*/, "");
}

/** Whether the file opens its own transaction and closes it. */
export function isSelfTransacting(text) {
  const body = stripLeadingComments(text).trimEnd();
  return /^BEGIN\s*(?:[A-Z ]*?)?;/i.test(body) && /COMMIT\s*;$/i.test(body);
}

/**
 * Splice the ledger insert into the migration's own transaction.
 *
 * "Applied" and "recorded as applied" have to be the same commit. If they are
 * two, a crash in between leaves a schema the runner will try to build again.
 */
export function withLedgerInsert({ name, body, checksum }) {
  const insert =
    "INSERT INTO schema_migrations (name, checksum) VALUES (" +
    `'${String(name).replace(/'/g, "''")}', ` +
    `'${String(checksum).replace(/'/g, "''")}');`;

  const trimmed = body.trimEnd();

  if (isSelfTransacting(trimmed)) {
    return trimmed.replace(/COMMIT\s*;$/i, `${insert}\nCOMMIT;`);
  }
  return `BEGIN;\n${trimmed}\n${insert}\nCOMMIT;`;
}
