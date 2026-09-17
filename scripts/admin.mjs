#!/usr/bin/env node
/**
 * Stand up an administrator who can actually sign in.
 *
 *   npm run db:admin                                  who the administrators are
 *   npm run db:admin -- you@yourdomain.com --name "Your Name"
 *
 * Everything else in this product is done *through* the product. This cannot
 * be, and the reason is worth stating rather than apologising for: the only
 * surface that creates an account is the administrator's own console, so a
 * deployment with no administrator has no way to get one. The seed deliberately
 * ships no password — "a seeded password is one every checkout knows" — which
 * is right, and leaves exactly this gap.
 *
 * So this is an operator action, taken with the database's own credentials,
 * and it is deliberately the smallest one that closes the gap:
 *
 *  - It **generates** the password rather than accepting one. A password passed
 *    as an argument is a password in shell history, in `ps`, and in whatever
 *    ships the terminal's scrollback somewhere.
 *  - It sets **`must_change`**, so the credential it prints is spent the first
 *    time it is used. `submitPassword` sends that session straight to a change
 *    form; a temporary credential somebody else chose must not quietly become
 *    a permanent one.
 *  - It **revokes every session** for the account, because re-credentialling is
 *    what you do when you think the old one was seen.
 *  - It **refuses to promote** an account that already exists as somebody else.
 *    A command that turns a college's login into an administrator is a
 *    privilege escalation with a friendly label.
 *
 * What it deliberately does **not** do is write an audit event. `audit_events`
 * requires a market and an actor, and an administrator has neither — but the
 * real reason is that this runs outside the application, so a row claiming the
 * application saw it happen would be a fabrication. It prints what it did and
 * logs a line; the record that this account exists is the account.
 *
 * Reads DATABASE_URL the same way the other operator scripts do, and writes
 * raw SQL for the same reason `seed.mjs` does: the Store is the application's
 * write path and is read-only by default, while this is an operator's.
 */

import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect } from "./pool.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Imported rather than restated. The hash format carries its own parameters and
// `checkPassword` holds the policy; a second copy of either here is a second
// source of truth that nothing would notice drifting.
const password = await import(pathToFileURL(join(ROOT, "src/domain/password.ts")).href);
const identity = await import(pathToFileURL(join(ROOT, "src/domain/identity.ts")).href);
const brand = await import(pathToFileURL(join(ROOT, "src/brand.ts")).href);
// Imported rather than written out, because it has already moved once: sign-in
// left `/demo/sign-in` and the instruction printed below went on naming the old
// path, which still redirects and so never looked broken.
const routes = await import(pathToFileURL(join(ROOT, "src/routes.ts")).href);

// ---------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------

/**
 * Domains nothing can be delivered to.
 *
 * RFC 2606 reserves `.example`, `.invalid`, `.test` and `.localhost`; RFC 6761
 * adds the rest. They matter here more than anywhere else in the product,
 * because **a reset code to that mailbox is the only recovery this account
 * has.** An administrator holds no organization, so nobody else can move their
 * address for them, and there is no second administrator to ask. An account on
 * an undeliverable domain is one forgotten password away from a database
 * console — which is why the seeded administrator, whose address is on the
 * brand's own reserved domain, cannot be given a credential here and a real
 * address has to be used instead.
 */
export const UNDELIVERABLE = new Set(["example", "invalid", "test", "localhost", "local"]);

/** The address is usable, or the reason it is not. */
export function checkAdminAddress(email) {
  const address = identity.normaliseEmail(String(email ?? ""));

  const at = address.indexOf("@");
  if (at <= 0 || at !== address.lastIndexOf("@") || at === address.length - 1) {
    return { ok: false, error: `"${email}" is not an email address.` };
  }
  if (/\s/.test(address)) {
    return { ok: false, error: "An address cannot contain spaces." };
  }

  const domain = address.slice(at + 1);
  const last = domain.split(".").pop() ?? "";
  if (!domain.includes(".") || UNDELIVERABLE.has(domain) || UNDELIVERABLE.has(last)) {
    return {
      ok: false,
      error:
        `Nothing can be delivered to "${domain}", and a reset code to this mailbox is the ` +
        `only way back into an administrator's account. Use an address you actually read.`,
    };
  }

  return { ok: true, address };
}

// ---------------------------------------------------------------------------
// The credential
// ---------------------------------------------------------------------------

/**
 * No `0`/`O`, no `1`/`l`/`I`.
 *
 * This is read off a terminal and typed into a browser once, so the characters
 * that get transcribed wrong are the ones worth leaving out.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const GROUPS = 4;
const GROUP_LENGTH = 5;

/**
 * A temporary password, grouped so it can be read aloud.
 *
 * `randomInt` rather than a modulo over random bytes, which biases toward the
 * low end of the alphabet — the same reason `generateCode` uses it. Twenty
 * characters of this alphabet is about 115 bits, which is far more than the
 * minutes-to-hours this credential is supposed to live.
 */
export function temporaryPassword() {
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/** Matches the id shape the services mint, so nothing can tell these apart. */
function mintId(prefix, at) {
  return `${prefix}-${at.getTime().toString(36)}${randomInt(36 ** 4).toString(36)}`;
}

export class AdminRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "AdminRefused";
  }
}

/**
 * Create the account or re-credential it, in one transaction.
 *
 * Takes a query-capable object rather than opening its own connection, so the
 * statements can be asserted without a database — the same seam `seedInto`
 * uses.
 */
export async function provisionAdmin(tx, input) {
  const { address, name, hash, now } = input;
  const at = now.toISOString();

  const { rows } = await tx.query(
    `SELECT u.id, u.name, m.id AS membership_id, m.role
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
      WHERE u.email = $1`,
    [address],
  );
  const existing = rows[0] ?? null;

  if (existing?.role && existing.role !== "admin") {
    throw new AdminRefused(
      `${address} already signs in as ${existing.role}. This command will not change what ` +
        `somebody is — that is a privilege escalation with a friendly label. Use an address ` +
        `that has no account.`,
    );
  }

  let userId = existing?.id ?? null;
  const created = !existing;

  if (!existing) {
    if (!name) {
      throw new AdminRefused(
        `No account for ${address} yet, so this would create one — and an account needs a ` +
          `name. Pass --name "Your Name".`,
      );
    }
    userId = mintId("u", now);
    await tx.query(`INSERT INTO users (id, name, email, created_at) VALUES ($1,$2,$3,$4)`, [
      userId,
      name,
      address,
      at,
    ]);
  } else if (name && name !== existing.name) {
    await tx.query(`UPDATE users SET name = $2 WHERE id = $1`, [userId, name]);
  }

  if (!existing?.membership_id) {
    // Null organization and null market, which `admin_is_cross_market` requires
    // and which is the whole shape of the role: the administrator is the only
    // actor not anchored to one market, and the only one that could not be
    // created by an organization's own form.
    await tx.query(
      `INSERT INTO memberships (id, user_id, organization_id, market_id, role, created_at)
       VALUES ($1,$2,NULL,NULL,'admin',$3)`,
      [mintId("mem", now), userId, at],
    );
  }

  await tx.query(
    `INSERT INTO user_passwords (user_id, password_hash, created_at, updated_at, must_change)
     VALUES ($1,$2,$3,$3,true)
     ON CONFLICT (user_id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            updated_at    = EXCLUDED.updated_at,
            must_change   = true`,
    [userId, hash, at],
  );

  // Every session goes. Putting a new password on an account is what somebody
  // does when they think the old one was seen, and leaving the sessions it
  // protected alive would make the change cosmetic — the same rule
  // `setOwnPassword` follows.
  await tx.query(
    `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, at],
  );

  return { created, userId, name: name ?? existing?.name ?? null };
}

/**
 * Who the administrators are, and what each of them can actually prove.
 *
 * The read that answers "is this deployment reachable by anybody" — an
 * administrator with no password and no authenticator is a row, not a way in.
 */
export async function listAdmins(tx) {
  const { rows } = await tx.query(
    `SELECT u.id, u.name, u.email,
            p.user_id IS NOT NULL                    AS has_password,
            COALESCE(p.must_change, false)           AS must_change,
            t.confirmed_at IS NOT NULL               AS has_authenticator
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_passwords p ON p.user_id = u.id
       LEFT JOIN user_totp t ON t.user_id = u.id
      WHERE m.role = 'admin'
      ORDER BY u.name`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** `--name Steve` and `--name=Steve`, plus a bare positional address. */
export function parseArgs(argv) {
  const parsed = { email: null, name: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name" || arg === "--email") {
      parsed[arg.slice(2)] = argv[++i] ?? null;
    } else if (arg.startsWith("--name=") || arg.startsWith("--email=")) {
      const [flag, ...rest] = arg.split("=");
      parsed[flag.slice(2)] = rest.join("=");
    } else if (!arg.startsWith("-") && !parsed.email) {
      parsed.email = arg;
    }
  }
  return parsed;
}

function report(admins) {
  if (admins.length === 0) {
    console.log(
      "No administrators.\n\n" +
        '  npm run db:admin -- you@yourdomain.com --name "Your Name"\n',
    );
    return;
  }
  console.log(`${admins.length} administrator${admins.length === 1 ? "" : "s"}:\n`);
  for (const admin of admins) {
    const credential = !admin.has_password
      ? "no password — cannot sign in"
      : admin.must_change
        ? "temporary password, must be changed"
        : "password set";
    const factor = admin.has_authenticator ? "authenticator enrolled" : "no authenticator";
    console.log(`  ${admin.name} <${admin.email}>`);
    console.log(`    ${credential} · ${factor}`);
  }
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = await connect();

  try {
    if (!args.email) {
      report(await listAdmins(pool));
      return;
    }

    const checked = checkAdminAddress(args.email);
    if (!checked.ok) throw new AdminRefused(checked.error);

    const temporary = temporaryPassword();
    // Belt and braces: the generator could in principle produce something the
    // policy refuses, and finding that out at the sign-in form would be a
    // credential nobody can spend.
    const policy = password.checkPassword(temporary, {
      email: checked.address,
      siteName: brand.brand.lead,
    });
    if (!policy.ok) throw new AdminRefused(`Generated password refused: ${policy.reason}`);

    const hash = await password.hashPassword(temporary);
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      result = await provisionAdmin(client, {
        address: checked.address,
        name: args.name?.trim() || null,
        hash,
        now: new Date(),
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    console.log(
      `\n${result.created ? "Created" : "Re-credentialled"} ${result.name} <${checked.address}>\n`,
    );
    console.log(`  Temporary password:  ${temporary}\n`);
    console.log(
      "It is shown once and is spent the first time it is used — signing in with it asks\n" +
        "for a password of your own before anything else.\n\n" +
        "  1. Put these in .env.local, which `next dev` reads:\n" +
        "       AUTH_MODE=code\n" +
        "       AUTH_ECHO_CODES=true\n" +
        "       DATABASE_READ_ONLY=false\n" +
        "     All three together. `AUTH_MODE=code` is what makes sign-on real rather\n" +
        "     than the demo role picker; without `DATABASE_READ_ONLY=false` you can sign\n" +
        "     in and every button then refuses.\n" +
        "  2. npm run dev\n" +
        `  3. Open http://localhost:3000${routes.SIGN_IN_PATH} and use the address above.\n` +
        "  4. Enrol an authenticator on the admin console, then set AUTH_REQUIRE_MFA=true.\n",
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof AdminRefused
        ? `\nRefused: ${error.message}\n`
        : `\ndb:admin failed: ${error.message ?? error}`,
    );
    process.exitCode = 1;
  }
}
