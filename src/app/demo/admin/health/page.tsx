import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
} from "@/components/ui";
import { actorForPortal } from "@/auth/session";
import { healthReport, type HealthStatus } from "@/services/health";
import { PORTAL_PATH } from "@/routes";

/**
 * System health, where somebody will actually look.
 *
 * `/api/health` is for a monitor. This is for the person the monitor wakes up,
 * and the difference is that a person needs to be told what to do about it.
 * Every line here is a count, a duration or a setting, and none of them names
 * anybody — the same rule the endpoint follows, because the reason for it is
 * the same in both places.
 */

export const metadata = {
  title: "System health",
  robots: { index: false, follow: false },
};

const TONE: Record<HealthStatus, "good" | "warn" | "crit"> = {
  ok: "good",
  degraded: "warn",
  failing: "crit",
};

const LABEL: Record<HealthStatus, string> = {
  ok: "Working",
  degraded: "Degraded",
  failing: "Failing",
};

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-good-600" aria-hidden="true" />;
  if (status === "degraded") return <CircleAlert className="w-4 h-4 text-warn-600" aria-hidden="true" />;
  return <TriangleAlert className="w-4 h-4 text-crit-600" aria-hidden="true" />;
}

/** What each check is actually answering, so a green row means something. */
const WHAT_IT_ANSWERS: Record<string, string> = {
  data: "Where records are read from, and whether that place is responding",
  schema: "Whether the database has the columns this build expects",
  notifications: "Whether anyone is actually being told, and whether the queue is draining",
  "sign-on": "How people get in, and whether that configuration boots",
  uploads: "Whether files are accepted, and what is scanning them",
};

export default async function HealthPage() {
  await actorForPortal("admin");
  const report = await healthReport();

  return (
    <div className="max-w-4xl mx-auto px-6 pt-8 pb-16 space-y-6">
      <Link
        href={PORTAL_PATH.admin}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-950"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to operations
      </Link>

      <PageHeader
        eyebrow="Program administrator"
        title="System health"
        subtitle="What is working, what is only appearing to, and what to do about it"
      />

      <Card>
        <CardHeader
          level={2}
          icon={<Activity className="w-5 h-5" />}
          title="Overall"
          subtitle={`Checked ${new Date(report.checkedAt).toLocaleTimeString("en-US")}`}
          action={<Badge tone={TONE[report.status]}>{LABEL[report.status]}</Badge>}
        />
        <div className="px-6 py-5">
          <p className="text-sm text-ink-600 leading-relaxed">
            {report.status === "ok" &&
              "Every check is answering. Nothing here needs attention."}
            {report.status === "degraded" &&
              "The application is serving requests, but something below is not doing what its name suggests. Degraded is the state that misleads people — it looks working from outside."}
            {report.status === "failing" &&
              "Something below is broken rather than reduced. The health endpoint answers 503 in this state, so an uptime monitor already knows."}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader level={2} title="Checks" subtitle="Worst first" />
        <ul className="divide-y divide-line">
          {[...report.checks]
            .sort(
              (a, b) =>
                ["failing", "degraded", "ok"].indexOf(a.status) -
                ["failing", "degraded", "ok"].indexOf(b.status),
            )
            .map((check) => (
              <li key={check.name} className="px-6 py-4 flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <StatusIcon status={check.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm text-ink-950">{check.name}</p>
                    {check.ms !== undefined && (
                      <span className="text-xs text-ink-500 font-mono">{check.ms}ms</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-700 mt-0.5">{check.detail}</p>
                  <p className="text-xs text-ink-500 mt-1">
                    {WHAT_IT_ANSWERS[check.name] ?? ""}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      </Card>

    </div>
  );
}
