import Link from "next/link";
import { ArrowLeft, Clock, Mail, TriangleAlert } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  Empty,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Assumption,
} from "@/components/ui";
import { actorForPortal } from "@/auth/session";
import { outboxFor } from "@/services/outbox";
import { emailConfig } from "@/services/email/config";

/**
 * The notification outbox.
 *
 * The administrator's recurring question is not "what changed" — the audit log
 * answers that — but "was anyone actually told?". A placement stalls because a
 * board never heard that a student booked, or an employer never heard that
 * funding cleared. A state change nobody was informed of is the same as no
 * state change, and until this page existed there was no way to see the
 * difference.
 */
export default async function OutboxPage() {
  const admin = await actorForPortal("admin");
  // Administrators are the one cross-market role; scoping to their own market
  // when they have one keeps a market operator from reading another's traffic.
  const { delivered, pending } = outboxFor(admin.membership.marketId);

  const config = emailConfig();
  const emailOn = config.enabled;
  const redirect = config.redirectTo;

  const failed = delivered.filter((n) => n.state !== "sent");
  const sent = delivered.filter((n) => n.state === "sent");

  return (
    <div className="max-w-5xl mx-auto px-6 pt-8 pb-16 space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-950"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to operations
      </Link>

      <PageHeader
        eyebrow="Program administrator"
        title="Notification outbox"
        subtitle="What the system told people, and what it failed to tell them"
      />

      {/* The single most important thing on this page: whether "delivered"
          means an email left the building or a line hit a log. Conflating the
          two would let an administrator believe a board was told when nothing
          was sent. */}
      <Card
        className={emailOn ? "p-5 bg-good-50 border-good-100" : "p-5 bg-ink-50"}
      >
        <div className="flex flex-wrap items-start gap-3">
          <span
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              emailOn ? "bg-good-600 text-white" : "bg-ink-200 text-ink-700"
            }`}
          >
            <Mail className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-[16rem]">
            <p className="font-bold text-sm text-ink-950">
              {emailOn
                ? "Email is sending through Resend"
                : "Email is not configured — messages are logged, not sent"}
            </p>
            <p className="text-xs text-ink-600 mt-1 max-w-2xl">
              {emailOn
                ? redirect
                  ? `Every message is redirected to ${redirect}, whatever recipient it names. Unset EMAIL_REDIRECT_TO to deliver to real recipients.`
                  : "Messages go to their real recipients. Addresses on reserved domains (every seeded organization uses one) are refused rather than bounced."
                : "Set RESEND_API_KEY to send. Until then everything below is a record of what would have gone out."}
            </p>
          </div>
          <Badge tone={emailOn ? "good" : "neutral"}>
            {emailOn ? (redirect ? "Redirected" : "Live") : "Console only"}
          </Badge>
        </div>
      </Card>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Delivered" value={String(sent.length)} tone="good" />
        <Stat
          label="Waiting to send"
          value={String(pending.length)}
          tone={pending.length > 0 ? "warn" : "neutral"}
          hint="Queued by a committed transaction"
        />
        <Stat
          label="Not delivered"
          value={String(failed.length)}
          tone={failed.length > 0 ? "crit" : "neutral"}
          hint="Someone was not told something"
        />
      </div>

      {failed.length > 0 && (
        <Card className="border-crit-100">
          <CardHeader
            icon={<TriangleAlert className="w-5 h-5" />}
            title="Undelivered"
            subtitle="Each of these is a person who does not know what they need to know"
          />
          <ul className="row-list divide-y divide-line">
            {failed.map((notification, index) => (
              <li key={`${notification.at}-${index}`} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm text-ink-950">
                      {notification.subject}
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {notification.recipientEmail} · {notification.kind}
                    </p>
                  </div>
                  <Badge tone="crit">
                    {notification.state === "undeliverable"
                      ? "Undeliverable"
                      : "Failed"}
                  </Badge>
                </div>
                {notification.error && (
                  <p className="text-xs text-crit-700 mt-2 font-semibold">
                    {notification.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pending.length > 0 && (
        <Card className="border-warn-100">
          <CardHeader
            icon={<Clock className="w-5 h-5" />}
            title="Queued"
            subtitle="Committed but not yet sent — these drain on the next transition"
          />
          <ul className="row-list divide-y divide-line">
            {pending.map((intent, index) => (
              <li
                key={`${intent.kind}-${index}`}
                className="px-6 py-3 flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-ink-950">{intent.kind}</span>
                <span className="text-xs text-ink-500">
                  {intent.recipientOrganizationId ?? intent.recipientUserId}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<Mail className="w-5 h-5" />}
          title="Delivered"
          subtitle="Newest first"
        />
        {sent.length === 0 ? (
          <Empty>
            Nothing has been sent yet. Move an application in any portal and the
            messages it generates will appear here.
          </Empty>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Sent</Th>
                  <Th>To</Th>
                  <Th>Subject</Th>
                  <Th>Kind</Th>
                </tr>
              </thead>
              <tbody className="row-list divide-y divide-line">
                {sent.map((notification, index) => (
                  <tr key={`${notification.at}-${index}`}>
                    <Td className="whitespace-nowrap text-xs text-ink-500 tabular">
                      {new Date(notification.at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {notification.recipientEmail}
                    </Td>
                    <Td>
                      <span className="font-semibold text-ink-950">
                        {notification.subject}
                      </span>
                      <span className="block text-xs text-ink-500 mt-0.5">
                        {notification.body}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone="neutral">{notification.kind}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="px-6 pb-5 pt-4">
          <Assumption>
            Held in the server process, so this resets when the process restarts
            and is per-instance rather than shared. A real deployment is the same
            two lists as one outbox table with a <code>delivered_at</code>{" "}
            column, drained by a worker rather than by whoever happened to
            trigger the last transition.
          </Assumption>
        </div>
      </Card>
    </div>
  );
}
