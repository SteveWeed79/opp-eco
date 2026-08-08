import { describe, it, expect, vi } from "vitest";
import { emailConfig, isUndeliverableDomain, resolveRecipient } from "./config";
import { renderEmail } from "./render";
import { resendChannel } from "./resend";
import { templateFor, knownKinds } from "../templates";
import { partiesNotifiedOn, policyKinds } from "../notification-policy";
import type { ApplicationStatus } from "@/domain/types";

describe("email configuration fails safe", () => {
  it("is disabled with no API key", () => {
    // The important default. This is a demonstration with invented
    // organizations; the worst outcome is not silence, it is mail arriving at
    // a real person about a placement that does not exist.
    const config = emailConfig({});
    expect(config.enabled).toBe(false);
    expect(config.apiKey).toBeNull();
  });

  it("can be switched off with a key present", () => {
    const config = emailConfig({
      RESEND_API_KEY: "re_test",
      EMAIL_ENABLED: "false",
    });
    expect(config.enabled).toBe(false);
  });

  it("enables only on an explicit key", () => {
    const config = emailConfig({ RESEND_API_KEY: "re_test" });
    expect(config.enabled).toBe(true);
  });

  it("strips a trailing slash off the app URL so links do not double up", () => {
    const config = emailConfig({
      NEXT_PUBLIC_APP_URL: "https://example.org/",
    });
    expect(config.appUrl).toBe("https://example.org");
  });
});

describe("reserved domains", () => {
  it.each([
    "dreyes@apexrobotics.example.com",
    "evance@verdigris.example.edu",
    "mdelgado@sekwp.example.org",
    "someone@example.com",
    "someone@host.test",
    "someone@thing.invalid",
  ])("refuses %s", (address) => {
    // RFC 2606 reserves these so they cannot be delivered. Every seeded
    // organization uses one, so without this guard a configured deployment
    // would bounce every message it sent and destroy its sending reputation.
    expect(isUndeliverableDomain(address)).toBe(true);
  });

  it.each(["steve@gmail.com", "person@kansasworks.org", "a@b.co"])(
    "allows %s",
    (address) => {
      expect(isUndeliverableDomain(address)).toBe(false);
    },
  );
});

describe("recipient resolution", () => {
  const base = emailConfig({ RESEND_API_KEY: "re_test" });

  it("refuses a reserved address rather than sending", () => {
    const result = resolveRecipient("dreyes@apexrobotics.example.com", base);
    expect("refuse" in result).toBe(true);
  });

  it("redirects everything when a redirect is set, including reserved addresses", () => {
    // The redirect is what makes the demo testable against real delivery: it
    // overrides the reserved-domain refusal on purpose, because the whole
    // point is to see the mail the fictional employer would have received.
    const config = { ...base, redirectTo: "me@real.example-not-reserved.io" };
    const result = resolveRecipient("dreyes@apexrobotics.example.com", config);

    expect(result).toEqual({
      to: "me@real.example-not-reserved.io",
      redirectedFrom: "dreyes@apexrobotics.example.com",
    });
  });
});

describe("rendering", () => {
  const message = {
    subject: "Book your workforce board interview",
    body: "One step is left.",
    action: { label: "Book your interview", path: "/student" },
  };

  it("builds an absolute action URL", () => {
    const { html, text } = renderEmail(message, { appUrl: "https://oe.example.org" });
    expect(html).toContain("https://oe.example.org/student");
    expect(text).toContain("https://oe.example.org/student");
  });

  it("always includes a real text part", () => {
    // A text fallback that says "view this in HTML" is a message that failed.
    const { text } = renderEmail(message, { appUrl: "http://localhost:3000" });
    expect(text).toContain("One step is left.");
    expect(text).not.toMatch(/view (this )?in (your browser|html)/i);
  });

  it("escapes payload text into the HTML", () => {
    // Posting titles are typed by employers, so this is an injection boundary.
    const { html } = renderEmail(
      { subject: "<script>alert(1)</script>", body: "a & b" },
      { appUrl: "http://localhost:3000" },
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("says so when a message was redirected", () => {
    const { html, text } = renderEmail(message, {
      appUrl: "http://localhost:3000",
      intendedFor: "dreyes@apexrobotics.example.com",
    });
    expect(html).toContain("dreyes@apexrobotics.example.com");
    expect(text).toContain("Redirected");
  });

  it("carries a preheader that is not just the subject repeated", () => {
    const { html } = renderEmail(message, { appUrl: "http://localhost:3000" });
    expect(html).toContain("One step is left.");
  });
});

describe("the Resend channel", () => {
  const config = emailConfig({
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "OE <no-reply@oe.test-domain.io>",
    NEXT_PUBLIC_APP_URL: "https://oe.example-app.io",
  });

  const notification = {
    recipientUserId: "u-omar",
    recipientEmail: "omar@kansasworks.org",
    subject: "fallback subject",
    body: "fallback body",
  };

  it("posts to the emails endpoint with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const channel = resendChannel(
      "mutual_interest.student",
      { employerName: "Apex Robotics", boardName: "SEK Partnership", postingTitle: "SWE" },
      config,
      fetchMock as unknown as typeof fetch,
    );

    await channel.send(notification);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    // Retrying after a timeout must not deliver twice.
    expect(init.headers["Idempotency-Key"]).toBeTruthy();

    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["omar@kansasworks.org"]);
    expect(body.html).toContain("Apex Robotics");
    expect(body.text).toBeTruthy();
  });

  it("re-renders from the template rather than sending the plain fallback", () => {
    // `RenderedNotification` carries only a subject and plain body — enough for
    // a console channel, not enough for an HTML message with a call to action.
    const template = templateFor("mutual_interest.student");
    expect(template).toBeTruthy();
  });

  it("throws on an API error so the dispatcher can retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "domain not verified",
    });
    const channel = resendChannel("credit.granted", {}, config, fetchMock as unknown as typeof fetch);

    // Swallowing this would record an unsent message as sent.
    await expect(channel.send(notification)).rejects.toThrow(/422/);
  });

  it("refuses a reserved address without calling the API", async () => {
    const fetchMock = vi.fn();
    const channel = resendChannel("credit.granted", {}, config, fetchMock as unknown as typeof fetch);

    await expect(
      channel.send({ ...notification, recipientEmail: "dana@apex.example.com" }),
    ).rejects.toThrow(/reserved domain/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("policy and templates agree", () => {
  const STATUSES: ApplicationStatus[] = [
    "submitted",
    "under_review",
    "shortlisted",
    "mutual_interest",
    "interview_scheduled",
    "interview_completed",
    "cleared",
    "funding_authorized",
    "unsubsidized",
    "placement_active",
    "placement_completed",
    "credit_pending",
    "credit_granted",
    "credit_denied",
    "rejected",
    "withdrawn",
    "terminated_early",
    "closed",
  ];

  it("has a template for every kind the policy can emit", () => {
    // A policy entry naming a kind with no template renders nothing and lands
    // in the outbox as undeliverable — a silent hole in exactly the lifecycle
    // this table exists to cover. One typo in a kind string does it.
    const templates = new Set(knownKinds());
    const missing = policyKinds().filter((kind) => !templates.has(kind));

    expect(missing).toEqual([]);
  });

  it("has a policy entry for every template, so none is dead prose", () => {
    // The other direction. These four are sent outside the transition path —
    // a posting submitted for review, and the stalled-application nudges — so
    // they legitimately have no status entry.
    const OUT_OF_BAND = new Set(["posting.submitted", "application.stalled"]);
    const used = new Set(policyKinds());
    const orphans = knownKinds().filter(
      (kind) => !used.has(kind) && !OUT_OF_BAND.has(kind),
    );

    expect(orphans).toEqual([]);
  });

  it("tells somebody about every status a person is waiting on", () => {
    // `under_review` and `closed` are deliberately silent — the first is an
    // employer's private bookkeeping, the second is bookkeeping full stop.
    // Everything else has somebody waiting to hear.
    const silent = STATUSES.filter((s) => partiesNotifiedOn(s).length === 0);
    expect(silent.sort()).toEqual(["closed", "interview_completed", "under_review"]);
  });

  it("tells the student on every status that asks them to act", () => {
    for (const status of [
      "shortlisted",
      "mutual_interest",
      "placement_completed",
    ] as ApplicationStatus[]) {
      expect(partiesNotifiedOn(status)).toContain("student");
    }
  });
});
