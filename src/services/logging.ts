/**
 * Structured logging with redaction.
 *
 * The failure this prevents is mundane and common: someone logs an error
 * object, or a whole record "just while debugging", and a student's name and
 * email land in a log aggregator that has none of the access controls the
 * database has. Under FERPA that is a disclosure, and under WIOA guidance a
 * log holding participant PII inherits the handling rules of the data itself.
 *
 * So logging takes an explicit context object and redacts by key before
 * anything is emitted. It is easier to use this than to hand-build a message,
 * which is the only reliable way to make the safe path the default one.
 */

/**
 * Keys whose values never reach a log, matched case-insensitively as
 * substrings so `studentEmail` and `contact_email` are both caught.
 */
const REDACTED_KEYS = [
  "email",
  "name",
  "phone",
  "address",
  "dob",
  "birth",
  "ssn",
  "social",
  "password",
  "token",
  "secret",
  "cookie",
  "authorization",
  "resume",
  "reason", // audit reasons are free text and routinely describe a person
];

const REDACTED = "[redacted]";

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEYS.some((needle) => lower.includes(needle));
}

/**
 * Recursively redact a value.
 *
 * Depth-bounded because an error object can carry a cyclic or enormous graph,
 * and a logger that hangs or blows the stack while reporting a failure is
 * worse than no logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    // The message may quote the record it failed on, so only the type and the
    // originating frame are kept.
    //
    // Note the trap: the first line of a stack *is* "Error: <message>", so
    // taking `stack[0]` reintroduces exactly what was being excluded. The
    // first real frame is the second line.
    const frames = value.stack?.split("\n") ?? [];
    return { error: value.name, at: frames[1]?.trim() ?? "unknown" };
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isRedactedKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return output;
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}…[truncated]`;
  }

  return value;
}

export type LogLevel = "info" | "warn" | "error";

/**
 * Emit a structured line.
 *
 * Identifiers are safe and useful — `applicationId` traces a problem without
 * naming anyone. Names, emails, and free text are not.
 */
export function log(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(redact(context) as Record<string, unknown>),
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => log("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => log("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => log("error", event, context),
};
