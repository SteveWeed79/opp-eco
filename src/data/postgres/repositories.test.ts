/**
 * The SQL repositories, checked without a database.
 *
 * A scoping rule that is right in TypeScript and wrong in SQL fails silently —
 * the query still returns rows, just too many of them. So these record the
 * statement each accessor produces and assert the narrowing is in it. The same
 * reasoning as `scoping.test.ts`, applied one layer up, where the mistake that
 * actually happened before was an accessor that forgot to compose a fragment
 * its neighbours all used.
 */

import { describe, it, expect } from "vitest";
import { postgresRepositories } from "./repositories";
import type { SqlClient } from "./client";
import { contextFor } from "@/data/session";
import type { Application } from "@/domain/types";

const admin = contextFor("admin");
const business = contextFor("business");
const college = contextFor("college");
const board = contextFor("board");
const student = contextFor("student");

/** Records every statement, and answers with whatever the test supplies. */
function recorder(rows: Record<string, unknown>[] = []) {
  const statements: { text: string; params: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      statements.push({ text, params });
      return rows as Row[];
    },
  };
  return {
    repositories: postgresRepositories(client),
    statements,
    last: () => statements[statements.length - 1],
  };
}

/** Every read an actor can perform, so none can be forgotten by a test. */
async function everyRead(
  repositories: ReturnType<typeof recorder>["repositories"],
  actor: typeof admin,
) {
  const application = {
    id: "app-1",
    studentId: "stu-1",
    status: "shortlisted",
  } as Application;

  await repositories.markets.list(actor);
  await repositories.markets.find(actor, "mkt-1");
  await repositories.organizations.list(actor);
  await repositories.organizations.list(actor, { kind: "college" });
  await repositories.organizations.find(actor, "org-1");
  await repositories.organizations.pendingVetting(actor);
  await repositories.students.list(actor);
  await repositories.students.find(actor, "stu-1");
  await repositories.students.pendingVerification(actor);
  await repositories.students.forUser(actor, "usr-1");
  await repositories.students.forApplication(actor, application);
  await repositories.postings.list(actor);
  await repositories.postings.list(actor, { status: "published" });
  await repositories.postings.find(actor, "post-1");
  await repositories.postings.published(actor);
  await repositories.postings.awaitingCollegeHelp(actor);
  await repositories.mentorshipOffers.list(actor);
  await repositories.mentorshipOffers.find(actor, "off-1");
  await repositories.mentorshipOffers.openInMarket(actor);
  await repositories.applications.list(actor);
  await repositories.applications.find(actor, "app-1");
  await repositories.applications.forStudent(actor, "stu-1");
  await repositories.applications.forPosting(actor, "post-1");
  await repositories.interviewSlots.list(actor);
  await repositories.interviewSlots.open(actor);
  await repositories.timeEntries.find(actor, "te-1");
  await repositories.timeEntries.forApplication(actor, "app-1");
  await repositories.timeEntries.forStudent(actor, "stu-1");
  await repositories.timeEntries.awaitingReview(actor);
  await repositories.creditAwards.list(actor);
  await repositories.creditAwards.forStudent(actor, "stu-1");
  await repositories.auditEvents.list(actor);
  await repositories.auditEvents.list(actor, { entityId: "app-1" });
}

describe("market isolation", () => {
  it("scopes every read to the actor's market", async () => {
    const { repositories, statements } = recorder();
    await everyRead(repositories, college);

    // `users.find` is the one deliberate exception and is not in `everyRead`:
    // it resolves the name behind an audit entry, which crosses markets.
    const unscoped = statements.filter((s) => !/\.market_id = \$/.test(s.text));
    expect(
      unscoped.map((s) => s.text.replace(/\s+/g, " ").trim().slice(0, 90)),
    ).toEqual([]);
  });

  it("carries the market as a parameter, never as text", async () => {
    const { repositories, statements } = recorder();
    await everyRead(repositories, board);

    for (const statement of statements) {
      expect(statement.text).not.toContain(board.membership.marketId!);
      expect(statement.params).toContain(board.membership.marketId);
    }
  });

  it("lets an administrator cross markets, which is the one role that may", async () => {
    const { repositories, statements } = recorder();
    await everyRead(repositories, admin);
    expect(statements.every((s) => !/\.market_id = \$/.test(s.text))).toBe(true);
  });
});

describe("business ownership", () => {
  it("narrows an employer's own records to its organization", async () => {
    const { repositories, statements } = recorder();

    await repositories.postings.list(business);
    await repositories.postings.find(business, "post-1");
    await repositories.mentorshipOffers.list(business);
    await repositories.mentorshipOffers.find(business, "off-1");
    await repositories.applications.list(business);
    await repositories.applications.find(business, "app-1");
    await repositories.applications.forStudent(business, "stu-1");
    await repositories.applications.forPosting(business, "post-1");
    await repositories.timeEntries.find(business, "te-1");
    await repositories.timeEntries.forApplication(business, "app-1");
    await repositories.timeEntries.awaitingReview(business);

    // Every one of these must mention the employer's own organization. An
    // accessor that only market-scopes is one an employer can use to read a
    // competitor's pipeline by guessing an id.
    for (const statement of statements) {
      expect(
        statement.params,
        `missing ownership narrowing: ${statement.text.replace(/\s+/g, " ").slice(0, 80)}`,
      ).toContain(business.membership.organizationId);
    }
  });

  it("leaves the market's shopfront open to everyone in it", async () => {
    // Published postings and open mentorship offers are what a market shows
    // its participants, including a business looking at a competitor's.
    const { repositories, last } = recorder();

    await repositories.postings.published(business);
    expect(last().params).not.toContain(business.membership.organizationId);

    await repositories.mentorshipOffers.openInMarket(business);
    expect(last().params).not.toContain(business.membership.organizationId);
  });
});

describe("a student reads only their own", () => {
  it("narrows applications and time entries to the signed-in user", async () => {
    const { repositories, statements } = recorder();

    await repositories.applications.list(student);
    await repositories.timeEntries.forStudent(student, "stu-1");
    await repositories.students.list(student);

    for (const statement of statements) {
      expect(statement.params).toContain(student.user.id);
    }
  });
});

describe("disclosure", () => {
  const studentRow = {
    id: "stu-1",
    market_id: "mkt-1",
    user_id: "usr-1",
    college_id: "org-college",
    name: "Omar Haddad",
    email: "omar@example.edu",
    program_of_study: "Computer Science",
    class_standing: "Sophomore",
    skills: [],
    interests: [],
    available_hours_per_week: 15,
    status: "verified",
    eligibility: "not_determined",
    eligibility_determined_on: null,
    verified_on: null,
  };

  const shortlisted = {
    id: "app-1",
    studentId: "stu-1",
    status: "shortlisted",
  } as Application;

  const active = {
    id: "app-2",
    studentId: "stu-1",
    status: "placement_active",
  } as Application;

  it("withholds a candidate's surname and email from an employer pre-clearance", async () => {
    const { repositories } = recorder([studentRow]);
    const result = await repositories.students.forApplication(business, shortlisted);

    expect(result!.name).not.toBe("Omar Haddad");
    expect(result!.email).toBe("");
  });

  it("releases the details once the placement is real", async () => {
    const { repositories } = recorder([studentRow]);
    const result = await repositories.students.forApplication(business, active);

    expect(result!.name).toBe("Omar Haddad");
    expect(result!.email).toBe("omar@example.edu");
  });

  it("does not redact for the college, which owns the relationship", async () => {
    const { repositories } = recorder([studentRow]);
    const result = await repositories.students.forApplication(college, shortlisted);
    expect(result!.name).toBe("Omar Haddad");
  });

  it("hides the work summary from the board but not the hours", async () => {
    const entry = {
      id: "te-1",
      market_id: "mkt-1",
      application_id: "app-1",
      student_id: "stu-1",
      business_id: "org-apex",
      week_starting: "2026-08-10",
      hours: "20.0",
      summary: "Wired the intake form",
      status: "approved",
      submitted_on: null,
      version: 1,
    };

    const forBoard = recorder([entry]);
    const boardRows = await forBoard.repositories.timeEntries.forApplication(
      board,
      "app-1",
    );
    // The board is pricing a claim, not reading a diary.
    expect(boardRows[0].summary).toBe("");
    expect(boardRows[0].hours).toBe(20);

    const forCollege = recorder([entry]);
    const collegeRows = await forCollege.repositories.timeEntries.forApplication(
      college,
      "app-1",
    );
    // The college awards credit for the work described, so it sees it.
    expect(collegeRows[0].summary).toBe("Wired the intake form");
  });
});

describe("statement shape", () => {
  it("joins users so a student is never returned without a name", async () => {
    const { repositories, last } = recorder();
    await repositories.students.list(college);
    expect(last().text).toContain("JOIN users");
  });

  it("aggregates the join tables rather than returning half an object", async () => {
    const { repositories, statements } = recorder();
    await repositories.markets.list(college);
    expect(statements[0].text).toContain("college_ids");

    await repositories.creditAwards.list(college);
    expect(statements[1].text).toContain("application_ids");

    await repositories.applications.list(college);
    expect(statements[2].text).toContain("credit_award_id");
  });

  it("orders the audit log newest first", async () => {
    const { repositories, last } = recorder();
    await repositories.auditEvents.list(admin);
    expect(last().text).toMatch(/ORDER BY occurred_at DESC/);
  });

  it("never lets a caller's value reach the statement text", async () => {
    const { repositories, last } = recorder();
    const hostile = "'; DROP TABLE applications; --";

    await repositories.applications.find(college, hostile);
    expect(last().text).not.toContain("DROP");
    expect(last().params).toContain(hostile);
  });
});
