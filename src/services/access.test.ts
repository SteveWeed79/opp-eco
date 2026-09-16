/**
 * Adding somebody to an organization, and moving their work address.
 *
 * The assertions that matter are the refusals and the clean-up. Adding an
 * account is ordinary; adding one on an address the administrator controls is
 * how a market operator quietly becomes a workforce board. Moving an address is
 * the recovery path; moving one without revoking what the old mailbox could
 * still open is a recovery path that leaves the old holder signed in.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  addOrganizationMember,
  changeWorkAddress,
  type AccessDeps,
} from "./access";
import { memoryStore } from "@/data/memory-store";
import { resetMemberships } from "@/data/session";
import { authStore } from "@/auth/backend";
import { resetAuthState } from "@/auth/memory-store";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";

const BOARD = "org-sekwp";
const COLLEGE_EMAIL = "evance@verdigris.example.edu";
const OFFICER_EMAIL = "mdelgado@sekwp.example.org";

let clock = new Date("2026-06-01T12:00:00.000Z");
let warnings: { to: string; message: string }[] = [];
let counter = 0;

const deps: AccessDeps = {
  store: memoryStore,
  now: () => clock,
  id: (prefix) => `${prefix}-test-${++counter}`,
  async warn(to, message) {
    warnings.push({ to, message });
  },
};

const admin = () => contextFor("admin");

/** The fixtures are process-global, so anything added has to be taken back. */
let users: typeof seed.users;
let audit: typeof seed.auditEvents;

beforeEach(() => {
  resetAuthState();
  resetMemberships();
  clock = new Date("2026-06-01T12:00:00.000Z");
  warnings = [];
  counter = 0;
  users = seed.users.map((u) => ({ ...u }));
  audit = seed.auditEvents.map((a) => ({ ...a }));
});

afterEach(() => {
  seed.users.splice(0, seed.users.length, ...users);
  seed.auditEvents.splice(0, seed.auditEvents.length, ...audit);
  resetMemberships();
});

describe("adding somebody to an organization", () => {
  it("gives them their own account on a work address", async () => {
    // The whole design of attribution: a second board officer is a second
    // account, not a shared login. What makes a determination attributable is
    // that `actorUserId` names a person.
    const result = await addOrganizationMember(
      admin(),
      { organizationId: BOARD, name: "Ray Okonkwo", email: "rokonkwo@sekwp.example.org" },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.name).toBe("Ray Okonkwo");

    const membership = await authStore().membershipForUser(result.result.id);
    expect(membership?.role).toBe("board");
    expect(membership?.organizationId).toBe(BOARD);
    // And they can be found by the address, which is what sign-on needs.
    expect((await authStore().findUserByEmail("rokonkwo@sekwp.example.org"))?.id).toBe(
      result.result.id,
    );
  });

  it("refuses an address off the organization's declared domain", async () => {
    // The control that stops an administrator adding an account on a mailbox
    // they read themselves. Without it, "add a colleague" is a way to mint a
    // board officer nobody at the board has ever met.
    const result = await addOrganizationMember(
      admin(),
      { organizationId: BOARD, name: "Ray Okonkwo", email: "rokonkwo@gmail.example" },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/work account|address is required/i);
  });

  it("refuses an address somebody already has", async () => {
    const result = await addOrganizationMember(
      admin(),
      { organizationId: BOARD, name: "Somebody Else", email: OFFICER_EMAIL },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate");
  });

  it("takes the role from the organization, never from the caller", async () => {
    // There is no field for it, and that is the point: a member form that could
    // mint an administrator is a privilege escalation with a friendly label.
    const result = await addOrganizationMember(
      admin(),
      { organizationId: BOARD, name: "Ray Okonkwo", email: "rokonkwo@sekwp.example.org" },
      deps,
    );
    if (!result.ok) throw new Error(result.error);
    const membership = await authStore().membershipForUser(result.result.id);
    expect(membership?.role).not.toBe("admin");
  });

  it("refuses anybody who is not an administrator", async () => {
    const result = await addOrganizationMember(
      contextFor("board"),
      { organizationId: BOARD, name: "Ray Okonkwo", email: "rokonkwo@sekwp.example.org" },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("records who was added, and to what", async () => {
    await addOrganizationMember(
      admin(),
      { organizationId: BOARD, name: "Ray Okonkwo", email: "rokonkwo@sekwp.example.org" },
      deps,
    );
    const entry = seed.auditEvents[0];
    expect(entry.entityType).toBe("user");
    expect(entry.to).toContain("Ray Okonkwo");
    expect(entry.actorRole).toBe("admin");
  });
});

describe("moving a work address", () => {
  const move = (over: Partial<Parameters<typeof changeWorkAddress>[1]> = {}) =>
    changeWorkAddress(
      admin(),
      {
        currentEmail: OFFICER_EMAIL,
        newEmail: "m.delgado@sekwp.example.org",
        reason: "Agency migrated staff mail to firstname.lastname",
        ...over,
      },
      deps,
    );

  it("moves it, and the account answers to the new address", async () => {
    const result = await move();
    expect(result.ok).toBe(true);

    const store = authStore();
    expect(await store.findUserByEmail("m.delgado@sekwp.example.org")).not.toBeNull();
    // And not to the old one, which is what stops a code being sent to a
    // mailbox the person no longer reads.
    expect(await store.findUserByEmail(OFFICER_EMAIL)).toBeNull();
  });

  it("requires a reason", async () => {
    const result = await move({ reason: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires a reason/i);
    // And nothing moved.
    expect(await authStore().findUserByEmail(OFFICER_EMAIL)).not.toBeNull();
  });

  it("refuses a move off the agency's own domain", async () => {
    // The control that matters most here. A public employee's account must not
    // be movable to an address an administrator controls — that is the whole
    // reason `emailDomains` exists.
    const result = await move({ newEmail: "marcia.delgado@gmail.example" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid");
    expect(await authStore().findUserByEmail(OFFICER_EMAIL)).not.toBeNull();
  });

  it("revokes every session and every code in flight", async () => {
    const store = authStore();
    const user = (await store.findUserByEmail(OFFICER_EMAIL))!;
    await store.createSession({
      id: "old-session",
      userId: user.id,
      createdAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + 3_600_000).toISOString(),
      lastSeenAt: clock.toISOString(),
      revokedAt: null,
    });
    await store.putSignInCode({
      userId: user.id,
      purpose: "sign_in",
      codeHash: "hash-of-a-code-already-sent",
      createdAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + 600_000).toISOString(),
      attempts: 0,
      consumedAt: null,
    });

    await move();

    // A session opened from the old mailbox must not outlive the mailbox.
    expect((await store.findSession("old-session"))?.revokedAt).not.toBeNull();
    // And a code already sitting in it is a key to a door just rehung.
    expect((await store.findSignInCode(user.id, "sign_in"))?.consumedAt).not.toBeNull();
  });

  it("warns the address being left behind", async () => {
    await move();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].to).toBe(OFFICER_EMAIL);
    // The old mailbox is the only one that proves anything: if the change was
    // not legitimate, this is what reaches whoever still holds it.
    expect(warnings[0].message).toMatch(/did not expect this/i);
  });

  it("records both addresses and the reason", async () => {
    await move();
    const entry = seed.auditEvents[0];
    expect(entry.entityType).toBe("user");
    expect(entry.from).toBe(OFFICER_EMAIL);
    expect(entry.to).toBe("m.delgado@sekwp.example.org");
    expect(entry.reason).toMatch(/firstname.lastname/);
  });

  it("refuses an address nobody holds", async () => {
    const result = await move({ currentEmail: "nobody@sekwp.example.org" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("refuses a move onto an address somebody else has", async () => {
    const result = await move({ newEmail: COLLEGE_EMAIL });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid");
  });

  it("refuses anybody who is not an administrator", async () => {
    const result = await changeWorkAddress(
      contextFor("board"),
      {
        currentEmail: OFFICER_EMAIL,
        newEmail: "m.delgado@sekwp.example.org",
        reason: "Because I would like to",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("does not rename the person", async () => {
    // A determination signed by Marcia Delgado in March must still say so in
    // October, whatever has happened to her mailbox in between.
    const before = (await authStore().findUserByEmail(OFFICER_EMAIL))!.name;
    await move();
    const after = await authStore().findUserByEmail("m.delgado@sekwp.example.org");
    expect(after?.name).toBe(before);
  });
});
