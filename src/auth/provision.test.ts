/**
 * The command that stands up the first administrator, without a database.
 *
 * It is the one write path in this product that no test can reach through the
 * application, because it exists precisely for the moment when there is no
 * account to sign in as. That makes it the easiest place for a mistake to live
 * unnoticed — and the consequences are the worst kind: an account nobody can
 * reach, or one that quietly holds a credential somebody else chose.
 *
 * Three classes of bug are cheap to make here and expensive to find on a live
 * connection, and all three are checkable against a recording client: a
 * placeholder count that disagrees with its parameter array, a statement that
 * stops being issued at all, and a refusal that stops refusing.
 */

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain JS operator script, which cannot import TypeScript
import {
  AdminRefused,
  checkAdminAddress,
  listAdmins,
  parseArgs,
  provisionAdmin,
  temporaryPassword,
} from "../../scripts/admin.mjs";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/domain/password";
import { brand, brandAddress } from "@/brand";

interface Recorded {
  text: string;
  params: unknown[];
}

/** A client that records what it was asked and answers with what it was given. */
function client(answers: Record<string, unknown>[][] = []) {
  const statements: Recorded[] = [];
  let answered = 0;
  return {
    statements,
    async query(text: string, params: unknown[] = []) {
      statements.push({ text, params });
      return { rows: answers[answered++] ?? [] };
    },
  };
}

const NOW = new Date("2026-09-17T12:00:00.000Z");

const input = {
  address: "steve@example-college.edu",
  name: "Steve Weed",
  hash: "scrypt$65536$8$1$abc$def",
  now: NOW,
};

/** Every statement of a kind, so "was it issued at all" is answerable. */
function matching(statements: Recorded[], fragment: string) {
  return statements.filter((s) => s.text.includes(fragment));
}

describe("the address it will accept", () => {
  it("takes one somebody actually reads", () => {
    const checked = checkAdminAddress("Steve@Example-College.edu");
    expect(checked.ok).toBe(true);
    // Normalised through the same function the sign-in form uses, or the
    // account would be reachable by a spelling nobody typed.
    if (checked.ok) expect(checked.address).toBe("steve@example-college.edu");
  });

  it("refuses a reserved domain, and says why it matters", () => {
    // The one refusal with a real cost attached: the seeded administrator is on
    // the brand's own reserved domain, and giving it a password would produce
    // an account whose only recovery — a reset code — can never be delivered.
    // RFC 2606 reserves those domains precisely so nothing tries.
    for (const address of [
      // The seeded administrator, built from the brand rather than spelled out.
      brandAddress("admin"),
      "someone@thing.invalid",
      "someone@thing.test",
      "someone@localhost",
    ]) {
      const checked = checkAdminAddress(address);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.error).toMatch(/only way back/);
    }
  });

  it("refuses something that is not an address", () => {
    for (const value of ["", "steve", "@nowhere.com", "steve@", "a@b@c.com", "st eve@a.com"]) {
      expect(checkAdminAddress(value).ok).toBe(false);
    }
  });

  it("refuses a bare hostname with no dot in it", () => {
    expect(checkAdminAddress("steve@intranet").ok).toBe(false);
  });
});

describe("the credential it generates", () => {
  it("passes the policy the sign-in form enforces", () => {
    // Generated rather than accepted, so nothing checks it at the moment it is
    // set. If the generator ever produced something `checkPassword` refuses,
    // the first anybody would know is an administrator unable to sign in with
    // the password they were just handed.
    for (let i = 0; i < 50; i++) {
      const generated = temporaryPassword();
      expect(generated.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
      expect(
        checkPassword(generated, { email: "steve@a-college.edu", siteName: brand.lead }).ok,
      ).toBe(true);
    }
  });

  it("leaves out the characters that get transcribed wrong", () => {
    // Read off a terminal and typed into a browser once. `0`/`O` and `1`/`l`/`I`
    // are the ones that come back as a failed sign-in rather than a typo.
    const sample = Array.from({ length: 200 }, () => temporaryPassword()).join("");
    expect(sample).not.toMatch(/[0O1lI]/);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => temporaryPassword()));
    expect(seen.size).toBe(200);
  });
});

describe("creating an account that does not exist", () => {
  it("writes the user, the membership, the password and nothing else", async () => {
    const tx = client([[]]);
    const result = await provisionAdmin(tx, input);

    expect(result.created).toBe(true);
    expect(matching(tx.statements, "INSERT INTO users")).toHaveLength(1);
    expect(matching(tx.statements, "INSERT INTO memberships")).toHaveLength(1);
    expect(matching(tx.statements, "INSERT INTO user_passwords")).toHaveLength(1);
  });

  it("anchors the membership to no organization and no market", async () => {
    // `admin_is_cross_market` refuses anything else, and the constraint is the
    // shape of the role rather than a detail: the administrator is the only
    // actor not anchored to one market, which is also why no organization's
    // own member form could ever have created this account.
    const tx = client([[]]);
    await provisionAdmin(tx, input);

    const membership = matching(tx.statements, "INSERT INTO memberships")[0];
    expect(membership.text).toContain("NULL,NULL,'admin'");
  });

  it("marks the password as one that must be changed", async () => {
    // The whole reason this command may print a credential at all. A temporary
    // password somebody else chose must be spent the first time it is used.
    const tx = client([[]]);
    await provisionAdmin(tx, input);

    const stored = matching(tx.statements, "INSERT INTO user_passwords")[0];
    expect(stored.text).toContain("true");
    expect(stored.params).toContain(input.hash);
  });

  it("revokes every session the account has", async () => {
    // Putting a new password on an account is what somebody does when they
    // think the old one was seen. Leaving the sessions it protected alive
    // makes the change cosmetic — the rule `setOwnPassword` already follows.
    const tx = client([[]]);
    await provisionAdmin(tx, input);

    const revoked = matching(tx.statements, "UPDATE sessions");
    expect(revoked).toHaveLength(1);
    expect(revoked[0].text).toContain("revoked_at IS NULL");
  });

  it("refuses to create an account with no name", async () => {
    const tx = client([[]]);
    await expect(provisionAdmin(tx, { ...input, name: null })).rejects.toBeInstanceOf(
      AdminRefused,
    );
    // Nothing written, not even the user row it got as far as needing a name for.
    expect(matching(tx.statements, "INSERT")).toHaveLength(0);
  });
});

describe("an account that already exists", () => {
  const existingAdmin = [
    { id: "u-admin", name: "Steve Weed", membership_id: "mem-admin", role: "admin" },
  ];

  it("re-credentials rather than duplicating", async () => {
    const tx = client([existingAdmin]);
    const result = await provisionAdmin(tx, input);

    expect(result.created).toBe(false);
    expect(matching(tx.statements, "INSERT INTO users")).toHaveLength(0);
    expect(matching(tx.statements, "INSERT INTO memberships")).toHaveLength(0);
    expect(matching(tx.statements, "INSERT INTO user_passwords")).toHaveLength(1);
    expect(matching(tx.statements, "UPDATE sessions")).toHaveLength(1);
  });

  it("upserts the password rather than failing on the primary key", async () => {
    const tx = client([existingAdmin]);
    await provisionAdmin(tx, input);

    const stored = matching(tx.statements, "INSERT INTO user_passwords")[0];
    expect(stored.text).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(stored.text).toContain("must_change   = true");
  });

  it("refuses to promote somebody who signs in as something else", async () => {
    // The refusal that matters most. A command able to turn a college's login
    // into an administrator is a privilege escalation with a friendly label,
    // and it would be reachable by anybody who can read a database URL.
    for (const role of ["college", "board", "business", "student"]) {
      const tx = client([[{ id: "u-ellen", name: "Dr. Ellen Vance", membership_id: "mem-1", role }]]);
      await expect(provisionAdmin(tx, input)).rejects.toBeInstanceOf(AdminRefused);
      expect(matching(tx.statements, "INSERT")).toHaveLength(0);
      expect(matching(tx.statements, "UPDATE")).toHaveLength(0);
    }
  });

  it("gives a membership to a user row that somehow has none", async () => {
    // A user with no membership resolves to nobody — `membershipForUser`
    // returns null and every sign-in path refuses. Repairable, and worth
    // repairing rather than refusing, because the alternative is an account
    // that can never be used and can never be replaced.
    const tx = client([[{ id: "u-orphan", name: "Steve Weed", membership_id: null, role: null }]]);
    const result = await provisionAdmin(tx, input);

    expect(result.created).toBe(false);
    expect(matching(tx.statements, "INSERT INTO memberships")).toHaveLength(1);
  });

  it("corrects the name when a new one is given", async () => {
    const tx = client([existingAdmin]);
    await provisionAdmin(tx, { ...input, name: "Stephen Weed" });
    expect(matching(tx.statements, "UPDATE users SET name")).toHaveLength(1);
  });

  it("leaves the name alone when none is given", async () => {
    const tx = client([existingAdmin]);
    await provisionAdmin(tx, { ...input, name: null });
    expect(matching(tx.statements, "UPDATE users SET name")).toHaveLength(0);
  });
});

describe("every statement it issues", () => {
  it("passes exactly as many parameters as it has placeholders", async () => {
    // The bug a live connection reports as a type error three tables later.
    const tx = client([[]]);
    await provisionAdmin(tx, input);

    for (const statement of tx.statements) {
      const placeholders = new Set(statement.text.match(/\$\d+/g) ?? []);
      expect(placeholders.size, statement.text).toBe(statement.params.length);
    }
  });
});

describe("reporting who can get in", () => {
  it("asks for the two things that decide it", async () => {
    // "Is this deployment reachable by anybody" is the question, and a row in
    // `memberships` does not answer it — an administrator with no password and
    // no authenticator is a record, not a way in.
    const tx = client([[]]);
    await listAdmins(tx);

    const [statement] = tx.statements;
    expect(statement.text).toContain("user_passwords");
    expect(statement.text).toContain("user_totp");
    expect(statement.text).toContain("m.role = 'admin'");
  });
});

describe("what it reads off the command line", () => {
  it("takes the address as a bare argument or a flag", () => {
    expect(parseArgs(["steve@a-college.edu"]).email).toBe("steve@a-college.edu");
    expect(parseArgs(["--email", "steve@a-college.edu"]).email).toBe("steve@a-college.edu");
    expect(parseArgs(["--email=steve@a-college.edu"]).email).toBe("steve@a-college.edu");
  });

  it("keeps a name with spaces in it whole", () => {
    expect(parseArgs(["a@b-college.edu", "--name", "Steve Weed"]).name).toBe("Steve Weed");
    expect(parseArgs(["a@b-college.edu", "--name=Steve Weed"]).name).toBe("Steve Weed");
  });

  it("reports nothing asked for when nothing was", () => {
    expect(parseArgs([])).toEqual({ email: null, name: null });
  });
});
