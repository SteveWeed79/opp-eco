import { headers } from "next/headers";
import { REQUEST_ID_HEADER } from "@/proxy";
import { logger, type LogLevel } from "./logging";

/**
 * The identifier for the request being handled.
 *
 * Set by `proxy.ts` on the way in and echoed on the way out, so the string in
 * somebody's response headers is the string in the log. That is the whole
 * value: "it failed when I clicked authorize" is unsearchable, and a report
 * carrying `K7MQ2XPD` is one query.
 *
 * Read from headers rather than held in an `AsyncLocalStorage`, because the
 * proxy and the render are different execution contexts and a store
 * established in one is not visible in the other. The cost is that reading it
 * is async, which is why this is a separate function rather than something
 * `logger` does by itself — `logger` is synchronous and called from places
 * that have no request at all.
 */
export async function requestId(): Promise<string | null> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER);
  } catch {
    // No request in scope — a script, a test, a background drain. Not an error.
    return null;
  }
}

/**
 * Log with the request id attached, when there is one.
 *
 * For the handful of places that log inside a request and would be worth
 * finding again: a refused write, a failed download, a server action that
 * threw. Everything else keeps using `logger` directly, because most logging
 * here is about a record rather than about a request.
 */
export async function logRequest(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  const id = await requestId();
  logger[level](event, id ? { ...context, requestId: id } : context);
}
