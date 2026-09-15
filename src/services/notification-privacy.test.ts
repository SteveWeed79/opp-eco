/**
 * Nothing that identifies a participant leaves in an email.
 *
 * The single most consequential rule in `docs/security-and-data.md`: TEGL 39-11
 * tells anyone handling participant PII in a WIOA-funded program never to email
 * it unencrypted. The $20/hour reimbursement is almost certainly WIOA Title I
 * money, so this binds — and the failure is silent, which is what makes a test
 * the right control rather than a code review habit.
 */

import { describe, it, expect } from "vitest";
import { FERPA_NOTICE, knownKinds, templateFor } from "./templates";
import { partyForKind } from "./notification-policy";
import {
  PARTICIPANT_PII_KEYS,
  participantPIIIn,
  withoutParticipantPII,
} from "./notification-privacy";
import * as seed from "@/data/seed";

/**
 * A payload with every PII key populated with a real seeded learner's details.
 *
 * Deliberately hostile: it hands each template exactly what it would have
 * reached for before this change, so a template that still reaches for a name
 * fails here rather than in somebody's inbox.
 */
const LEARNER = seed.students[0];

function hostilePayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    applicationId: "app-12",
    postingTitle: "Controls Technician Intern",
    employerName: "Apex Robotics",
    collegeName: "Verdigris State University",
    boardName: "Southeast Kansas Workforce Partnership",
    businessName: "Apex Robotics",
    organizationName: "Apex Robotics",
    mentorName: "Dana Reyes",
    mentorRole: "Director of Engineering",
    officerName: "Marcia Delgado",
    formatLabel: "Job shadow",
    track: "standard",
    hours: 12,
    rate: 20,
    ratePerHour: 20,
    capacity: 2,
    creditHours: 3,
    days: 9,
    score: 88,
    status: "cleared",
    weekStarting: "2026-03-02",
    startsAt: "2026-03-09T15:00:00.000Z",
    reason: "Needs a supervisor named.",
    note: "Please recheck Tuesday.",
    deliverable: "A tested ingestion job",
    selfSufficient: true,
  };
  // Every denied key, filled with this learner's actual details.
  for (const key of PARTICIPANT_PII_KEYS) payload[key] = String(pii(key));
  return payload;
}

function pii(key: string): unknown {
  switch (key) {
    case "studentName":
    case "learnerName":
      return LEARNER.name;
    case "studentEmail":
    case "learnerEmail":
      return LEARNER.email;
    case "programOfStudy":
      return LEARNER.programOfStudy;
    case "classStanding":
      return LEARNER.classStanding;
    case "expectedGraduation":
      return LEARNER.expectedGraduation;
    default:
      return `sensitive-${key}`;
  }
}

describe("no template names a participant", () => {
  const payload = hostilePayload();

  it.each(knownKinds())("%s renders without the learner's name", (kind) => {
    const message = templateFor(kind)!(payload);
    const rendered = `${message.subject}\n${message.body}\n${message.notice ?? ""}`;

    expect(rendered).not.toContain(LEARNER.name);
    expect(rendered).not.toContain(LEARNER.email);
    expect(rendered).not.toContain(LEARNER.programOfStudy);
  });

  it.each(knownKinds())("%s renders without any denied key's value", (kind) => {
    const message = templateFor(kind)!(payload);
    const rendered = `${message.subject}\n${message.body}\n${message.notice ?? ""}`;

    for (const key of PARTICIPANT_PII_KEYS) {
      expect(rendered, `${kind} leaked ${key}`).not.toContain(String(pii(key)));
    }
  });

  it("checks every learner in the seed, not only the first", () => {
    // A template could plausibly hard-code one name in a fallback. Cheap to
    // rule out, and the seed is small.
    const payloads = seed.students.map((student) => ({
      ...hostilePayload(),
      studentName: student.name,
      studentEmail: student.email,
    }));
    for (const kind of knownKinds()) {
      for (const [index, p] of payloads.entries()) {
        const message = templateFor(kind)!(p);
        const rendered = `${message.subject}\n${message.body}`;
        expect(rendered, `${kind} leaked ${seed.students[index].name}`).not.toContain(
          seed.students[index].name,
        );
      }
    }
  });

  it("still says which record it is about", () => {
    // Stripping the name is only half the job. A message with nothing to sort
    // on is one a board officer cannot act on, and the reference is what
    // replaced the name.
    const message = templateFor("mutual_interest.board")!(hostilePayload());
    expect(message.subject).toContain("APP-12");
  });
});

describe("the redisclosure notice", () => {
  const employerKinds = knownKinds().filter((kind) => partyForKind(kind) === "employer");

  it("covers the employer-facing kinds the policy table actually names", () => {
    expect(employerKinds.length).toBeGreaterThan(4);
  });

  it.each(
    knownKinds().filter((kind) => partyForKind(kind) === "employer"),
  )("%s carries it", (kind) => {
    // FERPA asks the institution sharing an education record to tell the
    // recipient it may not be passed on. The platform is what makes the sharing
    // easy, so the platform carries the notice.
    expect(templateFor(kind)!(hostilePayload()).notice).toBe(FERPA_NOTICE);
  });

  it("does not put it on a message to the learner about themselves", () => {
    // They are the subject of the record, not a recipient being warned about
    // redisclosure. A legal notice here would be noise.
    expect(templateFor("credit.granted")!(hostilePayload()).notice).toBeUndefined();
  });
});

describe("the payload guard", () => {
  it("strips every denied key", () => {
    const intent = {
      marketId: "mkt-1",
      recipientUserId: "u-1",
      kind: "application.submitted",
      payload: hostilePayload(),
    };
    const safe = withoutParticipantPII(intent);
    expect(participantPIIIn(safe.payload)).toEqual([]);
    expect(safe.payload.postingTitle).toBe("Controls Technician Intern");
  });

  it("returns the same object when there is nothing to strip", () => {
    // The common case, now that no caller sends a name. Allocating a copy per
    // message would be waste, and identity here is the cheap proof.
    const intent = {
      marketId: "mkt-1",
      recipientUserId: "u-1",
      kind: "application.submitted",
      payload: { postingTitle: "Controls Technician Intern" },
    };
    expect(withoutParticipantPII(intent)).toBe(intent);
  });

  it("keeps the names of people acting professionally", () => {
    // A board officer on an interview slot, a mentor, an employer contact. The
    // data rules keep those deliberately — a student booking a call should know
    // who they are meeting.
    const intent = {
      marketId: "mkt-1",
      recipientUserId: "u-1",
      kind: "interview.booked.student",
      payload: { officerName: "Marcia Delgado", mentorName: "Dana Reyes" },
    };
    const safe = withoutParticipantPII(intent);
    expect(safe.payload.officerName).toBe("Marcia Delgado");
    expect(safe.payload.mentorName).toBe("Dana Reyes");
  });
});
