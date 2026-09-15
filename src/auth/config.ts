/**
 * Which sign-on the process is running, and the guards that stop the wrong one.
 *
 * One decision from one environment variable, the same shape `DATABASE_URL`
 * uses to pick a data layer. The default is the demo picker, because the demo,
 * the unit suite and the end-to-end suite all depend on a process that boots
 * with no configuration and is still walkable.
 *
 *   AUTH_MODE unset    the role picker — anyone can be anyone
 *   AUTH_MODE=code     a one-time code to a work address, real sessions
 *
 * Two guards make that default safe, and both refuse at boot rather than
 * failing open at a request:
 *
 *  - **Demo sign-on against real, writable data is refused.** Not keyed on
 *    `NODE_ENV`, which says nothing about whether the records are real — a
 *    deployed demo is production and holds fixtures. Keyed on the thing that
 *    actually matters: a database is configured *and* writes are enabled, which
 *    together mean somebody's real data is behind a role picker.
 *  - **Real sign-on with no way to deliver a code is refused.** A code nobody
 *    can receive is an account nobody can reach, and the tempting workaround —
 *    letting it show up in the outbox — would publish a bearer token for every
 *    account to anyone who can open the admin console.
 */

export type AuthMode = "demo" | "code";

export interface AuthConfig {
  mode: AuthMode;
  /**
   * Write the code to the server log instead of requiring email.
   *
   * For a developer running real sign-on locally without a Resend key. Refused
   * in production, because a code in a log is a code in whatever aggregates
   * that log.
   */
  echoCodes: boolean;
}

export type AuthEnv = Record<string, string | undefined>;

/**
 * The one way past the guard on demo sign-on, and it is for the test suite.
 *
 * `npm run test:e2e` against Postgres needs exactly the combination that guard
 * refuses — the role picker, a database, and writes enabled — because every
 * flow it walks is a write and every account it walks them as comes from the
 * picker. It cannot be told apart by `NODE_ENV` either, because that suite runs
 * a production build; a deployed demo and a local end-to-end run look identical
 * to the process.
 *
 * So the distinction is made by hand, and the clumsiness of the value is the
 * safety: nobody sets a variable to this string about a database whose contents
 * they care about. Anything else, including "true", leaves the guard closed.
 */
const THROWAWAY = "i-am-a-test-database";

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export function authConfig(env: AuthEnv = process.env): AuthConfig {
  const mode: AuthMode = env.AUTH_MODE === "code" ? "code" : "demo";
  const production = env.NODE_ENV === "production";
  const echoCodes = env.AUTH_ECHO_CODES === "true" && !production;

  if (mode === "demo") {
    const writableDatabase =
      Boolean(env.DATABASE_URL) && env.DATABASE_READ_ONLY === "false";
    if (writableDatabase && env.AUTH_DEMO_WRITABLE_DB !== THROWAWAY) {
      throw new AuthConfigError(
        "Demo sign-on is refused when a writable database is configured: anyone could become anyone " +
          "and change real records. Set AUTH_MODE=code, or leave DATABASE_READ_ONLY unset to keep the " +
          `deployment read-only. If this is the end-to-end suite, set AUTH_DEMO_WRITABLE_DB="${THROWAWAY}" ` +
          "— and mean it.",
      );
    }
  }

  if (mode === "code") {
    const canDeliver = Boolean(env.RESEND_API_KEY) || echoCodes;
    if (!canDeliver) {
      throw new AuthConfigError(
        "AUTH_MODE=code needs RESEND_API_KEY, or nobody can receive a sign-in code. " +
          "Codes are deliberately never written to the notification outbox — that would publish a " +
          "bearer token for every account. Set AUTH_ECHO_CODES=true to log them in development.",
      );
    }
    if (env.AUTH_ECHO_CODES === "true" && production) {
      throw new AuthConfigError(
        "AUTH_ECHO_CODES writes sign-in codes to the server log and is refused in production.",
      );
    }
  }

  return { mode, echoCodes };
}

/** Whether the role picker should be offered at all. */
export function demoSignOnEnabled(env: AuthEnv = process.env): boolean {
  return authConfig(env).mode === "demo";
}

/**
 * Whether a signed-out visitor may be handed a demo identity.
 *
 * The demo hands anonymous callers a working account for whichever portal they
 * ask for, and themes the shell to a real partner college, because every screen
 * has to be reachable from a bare link. Under real sign-on that same fallback
 * **is the authentication bypass** — so it is tied to the mode here, in one
 * place both the session resolver and the theme resolver read, rather than
 * repeated as a comment promising a real deployment will remember to remove it.
 */
export function anonymousFallbackAllowed(env: AuthEnv = process.env): boolean {
  return authConfig(env).mode === "demo";
}


/**
 * Whether an administrator must have a second factor before they can sign in.
 *
 * Off by default, and that is not laziness. A deployment with the requirement
 * on and nobody enrolled has locked out the only account that could enrol
 * anybody — so the order is: stand the deployment up, enrol the administrators,
 * then turn this on. `verifySignInCode` says exactly that when it refuses.
 *
 * Anybody who *has* enrolled is challenged regardless of this flag. Enrolling
 * is the act of asking to be challenged.
 */
export function mfaRequired(env: AuthEnv = process.env): boolean {
  return env.AUTH_REQUIRE_MFA === "true";
}
