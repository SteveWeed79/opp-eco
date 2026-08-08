import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardCheck,
  MapPin,
  TrendingUp,
} from "lucide-react";
import {
  Assumption,
  Badge,
  Card,
  CardHeader,
  DwellBadge,
  Empty,
  Money,
  PageHeader,
  ProgressBar,
  Stat,
  StatusBadge,
  Td,
  Th,
  TableWrap,
  TrackBadge,
} from "@/components/ui";
import { repositories, organizationName } from "@/data/memory";
import { actorForPortal } from "@/auth/session";
import {
  allMarketHealth,
  averagePauseDays,
  funnel,
  stalledApplications,
  subsidyDeployed,
} from "@/lib/queries";
import type { MarketStage } from "@/domain/types";

const STAGE_ORDER: MarketStage[] = [
  "prospecting",
  "board_engaged",
  "board_committed",
  "college_engaged",
  "college_committed",
  "configuring",
  "live",
];

const STAGE_LABEL: Record<MarketStage, string> = {
  prospecting: "Prospecting",
  board_engaged: "Board engaged",
  board_committed: "Board committed",
  college_engaged: "College engaged",
  college_committed: "College committed",
  configuring: "Configuring",
  live: "Live",
  paused: "Paused",
  declined: "Declined",
};

export default async function AdminPage() {
  const admin = await actorForPortal("admin");
  const health = allMarketHealth(admin);
  const stalled = stalledApplications(admin);
  const pendingOrgs = repositories.organizations.pendingVetting(admin);
  const stages = funnel(admin);
  const liveMarkets = health.filter((h) => h.market.stage === "live");
  const totalBudget = liveMarkets.reduce((s, h) => s + h.market.subsidyBudget, 0);
  const deployed = subsidyDeployed(admin);
  const inPause = stalled.filter((s) => s.inPause).length;

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
      <PageHeader
        dark
        eyebrow="Program administrator"
        title="Ecosystem Operations"
        subtitle={`${liveMarkets.length} live ${liveMarkets.length === 1 ? "market" : "markets"} · ${health.length - liveMarkets.length} in the launch pipeline`}
      />

      {/* Exception-first: the numbers that mean someone has to do something */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Stalled in the pause"
          value={String(inPause)}
          hint="Waiting on a board interview or determination"
          tone={inPause > 0 ? "crit" : "good"}
        />
        <Stat
          label="Total stalled"
          value={String(stalled.length)}
          hint="Any queue sitting more than 5 days"
          tone={stalled.length > 3 ? "warn" : "neutral"}
        />
        <Stat
          label="Awaiting vetting"
          value={String(pendingOrgs.length)}
          hint="Organizations wanting to join"
          tone={pendingOrgs.length > 0 ? "warn" : "good"}
        />
        <Stat
          label="Subsidy committed"
          value={`$${Math.round(deployed / 1000)}K`}
          hint={`of $${Math.round(totalBudget / 1000)}K allocated`}
          tone="brand"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* What's stuck — the administrator's actual job                       */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          icon={<AlertTriangle className="w-5 h-5" />}
          title="What's stuck"
          subtitle="Sorted with the pause first, because that is where placements die"
        />
        {stalled.length === 0 ? (
          <Empty>Nothing is waiting. Every queue is inside its threshold.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-ink-100">
                <tr>
                  <Th>Student</Th>
                  <Th>Opportunity</Th>
                  <Th>State</Th>
                  <Th>Waiting on</Th>
                  <Th>Dwell</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {stalled.map((item) => (
                  <tr
                    key={item.application.id}
                    className={item.inPause ? "bg-warn-50/40" : undefined}
                  >
                    <Td className="font-semibold text-ink-950 whitespace-nowrap">
                      {item.student.name}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap">{item.posting.title}</span>
                        <TrackBadge track={item.application.track} posting={item.posting} />
                      </div>
                      <span className="text-xs text-ink-500">
                        {organizationName(item.posting.businessId)}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={item.application.status} />
                    </Td>
                    <Td className="text-xs">{item.blockedOn}</Td>
                    <Td>
                      <DwellBadge days={item.days} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Market pipeline — the business the administrator is actually in     */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-extrabold text-ink-950">Market pipeline</h2>
          <p className="text-sm text-ink-500">
            Board first, then college, then the market opens
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {health
            .slice()
            .sort(
              (a, b) =>
                STAGE_ORDER.indexOf(b.market.stage) - STAGE_ORDER.indexOf(a.market.stage),
            )
            .map((h) => {
              const isLive = h.market.stage === "live";
              const stageIndex = STAGE_ORDER.indexOf(h.market.stage);
              return (
                <Card key={h.market.id} className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-ink-500 text-xs font-semibold uppercase tracking-wider">
                        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                        {h.market.city}
                      </div>
                      <h3 className="text-lg font-bold text-ink-950 mt-1">
                        {h.market.name}
                      </h3>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {h.market.counties.join(" · ")} County
                      </p>
                    </div>
                    <Badge tone={isLive ? "good" : "warn"}>
                      {STAGE_LABEL[h.market.stage]}
                    </Badge>
                  </div>

                  <div className="mt-4">
                    <ProgressBar
                      value={stageIndex + 1}
                      max={STAGE_ORDER.length}
                      tone={isLive ? "good" : "brand"}
                    />
                    <p className="text-xs text-ink-500 mt-1.5">
                      Step {stageIndex + 1} of {STAGE_ORDER.length} ·{" "}
                      {h.market.boardId
                        ? organizationName(h.market.boardId)
                        : "No board secured"}
                    </p>
                  </div>

                  {isLive ? (
                    <>
                      <dl className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-ink-100">
                        <div>
                          <dt className="text-xs text-ink-500 font-semibold">Students</dt>
                          <dd className="text-lg font-black text-ink-950 tabular">
                            {h.activeStudents}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-ink-500 font-semibold">Businesses</dt>
                          <dd className="text-lg font-black text-ink-950 tabular">
                            {h.activeBusinesses}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-ink-500 font-semibold">Placed</dt>
                          <dd className="text-lg font-black text-ink-950 tabular">
                            {h.placements}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-ink-500 font-semibold">In pause</dt>
                          <dd
                            className={`text-lg font-black tabular ${h.inPause > 0 ? "text-warn-700" : "text-ink-950"}`}
                          >
                            {h.inPause}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-5 pt-5 border-t border-ink-100">
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-xs font-bold text-ink-600 uppercase tracking-wider">
                            {h.market.programYear} subsidy allocation
                          </span>
                          <span className="text-xs text-ink-500">
                            <Money value={h.committed} /> of{" "}
                            <Money value={h.market.subsidyBudget} />
                          </span>
                        </div>
                        <ProgressBar
                          value={h.committed}
                          max={h.market.subsidyBudget}
                          tone={
                            h.committed / h.market.subsidyBudget > 0.8 ? "crit" : "brand"
                          }
                        />
                        <p className="text-xs text-ink-500 mt-1.5">
                          <Money value={h.remaining} /> uncommitted at $
                          {h.market.subsidyRatePerHour}/hr
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-ink-500 mt-5 pt-5 border-t border-ink-100">
                      {h.market.stage === "configuring"
                        ? "College committed. Configuring credit policy and terms before opening to students."
                        : h.market.stage === "board_committed"
                          ? "Board committed. Next step is securing a college partner."
                          : "Early conversations. No commitments yet."}
                    </p>
                  )}
                </Card>
              );
            })}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Vetting + funnel                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<ClipboardCheck className="w-5 h-5" />}
            title="Awaiting vetting"
            subtitle="Nothing transacts until an organization is approved"
          />
          {pendingOrgs.length === 0 ? (
            <Empty>No organizations waiting.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {pendingOrgs.map((org) => (
                <li
                  key={org.id}
                  className="px-6 py-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-semibold text-sm text-ink-950">{org.name}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {org.county} County · {org.contactName}
                    </p>
                  </div>
                  <Badge
                    tone={
                      org.status === "info_requested"
                        ? "warn"
                        : org.status === "under_review"
                          ? "brand"
                          : "neutral"
                    }
                  >
                    {org.status === "info_requested"
                      ? "Info requested"
                      : org.status === "under_review"
                        ? "Under review"
                        : "New"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<TrendingUp className="w-5 h-5" />}
            title="Funnel"
            subtitle={`Applications in the pause have been waiting ${averagePauseDays(admin)} days on average`}
          />
          <div className="px-6 py-5 space-y-3">
            {stages.map((stage, i) => {
              const max = stages[0].count || 1;
              const isPause = stage.label === "Through the pause";
              return (
                <div key={stage.label}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span
                      className={`text-sm ${isPause ? "font-bold text-ink-950" : "text-ink-700"}`}
                    >
                      {stage.label}
                    </span>
                    <span className="text-sm font-bold text-ink-950 tabular">
                      {stage.count}
                      {i > 0 && (
                        <span className="text-xs font-normal text-ink-500 ml-2">
                          {Math.round((stage.count / (stages[i - 1].count || 1)) * 100)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <ProgressBar
                    value={stage.count}
                    max={max}
                    tone={isPause ? "warn" : "brand"}
                  />
                </div>
              );
            })}
            <Assumption>
              Boards hold a fixed annual allocation that placements draw down (Q20). If
              funding is uncapped, the budget rail on each market comes out.
            </Assumption>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-brand-500" aria-hidden="true" />
            <div>
              <p className="font-bold text-sm text-ink-950">
                Every state change is written to an immutable audit log
              </p>
              <p className="text-xs text-ink-500 mt-0.5">
                Which is also what makes this reporting free rather than computed ad hoc
              </p>
            </div>
          </div>
          <Link
            href="/admin/audit"
            className="text-sm font-bold text-brand-600 hover:text-ink-950 flex items-center gap-1.5"
          >
            View audit log <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </div>
  );
}
