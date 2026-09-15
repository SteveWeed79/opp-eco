/**
 * The notification queue, in SQL.
 *
 * `notification_outbox` is written inside the same transaction as the state
 * change that caused it — that is what makes "a placement never advances
 * without someone being told" true rather than aspirational. This is the other
 * half: claiming those rows afterwards and handing them to the dispatcher.
 *
 * It exists because that half was missing. `outbox.ts` drained the in-memory
 * array directly, so a deployment reading Postgres wrote every message to the
 * table and sent none of them: the audit log said the board was told, the
 * outbox screen said nothing had been sent, and both were right.
 *
 * **Claiming marks the row dispatched.** A message that leaves this queue has
 * left it, the same way `splice` empties an array — otherwise two server
 * instances draining at once would send everything twice. A failure a retry
 * could fix comes back through `requeue`, which clears the mark and records
 * why; a permanent one stays claimed, because a poison message that returns
 * forever is a queue that never drains.
 */

import type {
  NotificationIntent,
  NotificationQueue,
  QueuedNotification,
} from "../store";
import type { SqlClient } from "./client";

interface OutboxRow {
  id: string | number;
  market_id: string;
  recipient_user_id: string | null;
  recipient_organization_id: string | null;
  kind: string;
  payload: Record<string, unknown> | string | null;
}

/**
 * A row as the dispatcher expects an intent.
 *
 * The synthetic `contact:` address is rebuilt rather than stored: it is how the
 * policy layer names a party with no account, and the column it would have gone
 * in references `users`, where no such row exists.
 */
function toIntent(row: OutboxRow): NotificationIntent {
  const organizationId = row.recipient_organization_id ?? undefined;
  return {
    marketId: row.market_id,
    recipientUserId:
      row.recipient_user_id ?? (organizationId ? `contact:${organizationId}` : ""),
    recipientOrganizationId: organizationId,
    kind: row.kind,
    payload:
      typeof row.payload === "string"
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : (row.payload ?? {}),
  };
}

const COLUMNS = `id, market_id, recipient_user_id, recipient_organization_id, kind, payload`;

export function postgresNotificationQueue(db: SqlClient): NotificationQueue {
  return {
    async take() {
      // One statement, so the claim and the read cannot come apart. `attempts`
      // counts deliveries tried rather than rows written, which is what makes a
      // message that keeps failing visible in the table.
      const rows = await db.query<OutboxRow>(
        `UPDATE notification_outbox
            SET dispatched_at = now(), attempts = attempts + 1
          WHERE dispatched_at IS NULL
        RETURNING ${COLUMNS}`,
      );
      return rows.map((row) => ({ id: String(row.id), intent: toIntent(row) }));
    },

    async requeue(item: QueuedNotification, error: string) {
      if (!item.id) return;
      await db.query(
        `UPDATE notification_outbox
            SET dispatched_at = NULL, last_error = $2
          WHERE id = $1`,
        [item.id, error],
      );
    },

    async pending(marketId: string | null) {
      const rows = marketId
        ? await db.query<OutboxRow>(
            `SELECT ${COLUMNS} FROM notification_outbox
              WHERE dispatched_at IS NULL AND market_id = $1
              ORDER BY created_at DESC, id DESC`,
            [marketId],
          )
        : await db.query<OutboxRow>(
            `SELECT ${COLUMNS} FROM notification_outbox
              WHERE dispatched_at IS NULL
              ORDER BY created_at DESC, id DESC`,
          );
      return rows.map(toIntent);
    },
  };
}

/**
 * The queue a read-only deployment gets.
 *
 * Claiming a row is a write, and a demonstration pointed at a shared database
 * must not mark someone else's messages as sent. Nothing can be enqueued there
 * either — every write is refused before a transaction opens — so an empty
 * claim is the truth rather than a suppression. What is already waiting is
 * still listed, because reading is what that deployment is for.
 */
export function readOnlyNotificationQueue(db: SqlClient): NotificationQueue {
  const queue = postgresNotificationQueue(db);
  return {
    async take() {
      return [];
    },
    async requeue() {},
    pending: queue.pending,
  };
}
