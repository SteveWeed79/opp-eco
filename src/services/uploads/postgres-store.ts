/**
 * The Postgres file store.
 *
 * Same contract as the in-memory one, so nothing above it knows which it got —
 * `receiveUpload`, the retrieval route and the access rules are unchanged.
 *
 * **Bytes cross the wire as base64 text, deliberately.** The obvious thing is
 * to pass a `Buffer` and let the driver handle `bytea`, and that works on
 * node-postgres. It does not work uniformly: this app also runs on Neon, whose
 * HTTP path serialises parameters as JSON, where a `Buffer` becomes
 * `{"type":"Buffer","data":[…]}` and a `bytea` result can come back as a
 * `\x`-prefixed hex string rather than bytes. Encoding in SQL — `decode($n,
 * 'base64')` going in, `encode(content, 'base64')` coming out — makes every
 * parameter and every result a plain string, which every driver agrees about.
 * It costs a third more on the wire than the binary would, and it removes a
 * class of bug that only appears in production against the one driver the
 * tests do not run.
 */

import { randomUUID } from "node:crypto";
import type { SqlClient } from "@/data/postgres/client";
import type { FileStore, ScanStatus, StoredFile } from "./storage";
import type { UploadPurpose } from "./validation";

type Row = Record<string, unknown>;

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const nullableText = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : String(value);
}

function toMeta(row: Row): StoredFile {
  return {
    key: text(row.key),
    purpose: text(row.purpose) as UploadPurpose,
    filename: text(row.filename),
    contentType: text(row.content_type),
    bytes: Number(row.bytes ?? 0),
    uploadedBy: text(row.uploaded_by),
    uploadedAt: stamp(row.uploaded_at),
    studentId: text(row.student_id),
    applicationId: nullableText(row.application_id),
    scan: text(row.scan) as ScanStatus,
  };
}

/** Every column except the content, which is only fetched when it is wanted. */
const META_COLUMNS = `key, purpose, filename, content_type, bytes, uploaded_by,
  uploaded_at, student_id, application_id, scan`;

export function postgresFileStore(client: SqlClient): FileStore {
  return {
    async put(file, data) {
      const key = randomUUID();
      const rows = await client.query<Row>(
        `INSERT INTO uploaded_files
           (key, purpose, filename, content_type, bytes, uploaded_by,
            student_id, application_id, scan, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, decode($10, 'base64'))
         RETURNING ${META_COLUMNS}`,
        [
          key,
          file.purpose,
          file.filename,
          file.contentType,
          file.bytes,
          file.uploadedBy,
          file.studentId,
          file.applicationId ?? null,
          file.scan,
          Buffer.from(data).toString("base64"),
        ],
      );
      return toMeta(rows[0]!);
    },

    async get(key) {
      const rows = await client.query<Row>(
        `SELECT ${META_COLUMNS}, encode(content, 'base64') AS content_b64
           FROM uploaded_files WHERE key = $1`,
        [key],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        meta: toMeta(row),
        data: new Uint8Array(Buffer.from(text(row.content_b64), "base64")),
      };
    },

    async metadata(key) {
      const rows = await client.query<Row>(
        `SELECT ${META_COLUMNS} FROM uploaded_files WHERE key = $1`,
        [key],
      );
      return rows[0] ? toMeta(rows[0]) : null;
    },

    async markScanned(key, status) {
      await client.query(`UPDATE uploaded_files SET scan = $2 WHERE key = $1`, [
        key,
        status,
      ]);
    },

    async remove(key) {
      await client.query(`DELETE FROM uploaded_files WHERE key = $1`, [key]);
    },

    async removeForStudent(studentId) {
      // Returns the keys rather than a count, so the caller can say what went
      // in an audit entry instead of asserting that something did.
      const rows = await client.query<Row>(
        `DELETE FROM uploaded_files WHERE student_id = $1 RETURNING key`,
        [studentId],
      );
      return rows.map((row) => text(row.key));
    },
  };
}
