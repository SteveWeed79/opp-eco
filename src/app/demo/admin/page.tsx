import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardCheck,
  Compass,
  HandCoins,
  HandHeart,
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
  PageSection,
  ProgressBar,
  Stat,
  STATUS_META,
  StatusBadge,
  Td,
  Th,
  TableWrap,
  TrackBadge,
} from "@/components/ui";
import { repositories } from "@/data/backend";
import { nameLookups } from "@/lib/names";
import { organizationMachine } from "@/domain/lifecycle";
import { organizationLifecycle } from "@/app/_actions/lifecycle";
import {
  TransitionActions,
  ORGANIZATION_CONFIRM,
} from "@/components/TransitionActions";
import { actorForPortal } from "@/auth/session";
import {
  allMarketHealth,
  averagePauseDays,
  funnel,
  outcomeReport,
  stalledApplications,
  subsidyDeployed,
} from "@/lib/queries";
import type { MarketStage, MentorshipPairing } from "@/domain/types";
import { mentorshipFormatLabel, placesLeft } from "@/domain/mentorship";
import { balancesFor, fundPurposeLabel } from "@/domain/funding";
import { AwardFunds, type FundableLearner } from "@/components/AwardFunds";
import { AdjustAllocation } from "@/app/demo/board/AdjustAllocation";
import { adminAdjustAllocation, adminAwardFunds } from "./actions";
import type { ApplicationStatus } from "@/domain/types";
import { isRegionalEmployment, OUTCOME_KINDS } from "@/domain/outcome";
import { IntroduceStudent } from "@/components/IntroduceStudent";
import { adminIntroduceStudent } from "./actions";
import { PORTAL_PATH } from "@/routes";

/**
 * The two kinds that mean the talent stayed, resolved from the domain rather
 * than listed here — a second copy is the one that goes stale the day a kind
 * is added.
 */
/** Placements far enough along that a cost has actually been incurred. */
const FUNDABLE_STATUSES = new Set<ApplicationStatus>([
  "placement_active",
  "placement_completed",
  "credit_pending",
  "credit_granted",
]);

const REGIONAL_KINDS = new Set(
  OUTCOME_KINDS.map((k) => k.value).filter(isRegionalEmployment),
);

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
  const { organizationName, marketName } = await nameLookups(admin);

  // Mentorship, across every market — the view only this console has. An offer
  // with places nobody has been introduced to is the administrator's to act on
  // when a college has not.
  const openMentorships = (await repositories.mentorshipOffers.list(admin)).filter(
    (offer) => offer.status === "open",
  );
  const pairingsByOffer = new Map<string, MentorshipPairing[]>();
  for (const pairing of await repositories.mentorshipPairings.list(admin)) {
    pairingsByOffer.set(pairing.offerId, [
      ...(pairingsByOffer.get(pairing.offerId) ?? []),
      pairing,
    ]);
  }
  const verified = (await repositories.students.list(admin)).filter(
    (student) => student.status === "verified",
  );
  /** Verified students in one market — an introduction never crosses one. */
  const introducibleIn = (marketId: string) =>
    verified
      .filter((student) => student.marketId === marketId)
      .map((student) => ({
        id: student.id,
        name: student.name,
        programOfStudy: student.programOfStudy,
        classStanding: student.classStanding,
      }));
  // Independent of one another, so resolved together rather than in a queue
  // of six sequential round trips.
  const [health, stalled, pendingOrgs, stages, deployed, pauseDays, outcomes] =
    await Promise.all([
      allMarketHealth(admin),
      stalledApplications(admin),
      await repositories.organizations.pendingVetting(admin),
      funnel(admin),
      subsidyDeployed(admin),
      averagePauseDays(admin),
      outcomeReport(admin),
    ]);
  /**
   * Every fund across every market, and who could be awarded from one.
   *
   * The administrator is the only actor who sees funding whole — a board sees
   * its own market, a college its own institution's — and seeing it whole is
   * what "funding coordination" means when it is a product rather than a
   * sentence on a website.
   */
  const [allFunds, allCommitments, allStudentsForFunding, allApplications] =
    await Promise.all([
      repositories.fundingSources.list(admin),
      repositories.fundingCommitments.list(admin),
      repositories.students.list(admin),
      repositories.applications.list(admin),
    ]);
  const fundBalances = balancesFor(allFunds, allCommitments);
  const studentNameById = new Map(allStudentsForFunding.map((s) => [s.id, s.name]));

  /**
   * Learners a fund could be awarded to: one whose placement has started.
   *
   * Narrowed to started placements because every purpose this seeds — credit
   * cost, transport — is a cost the learner incurs by taking the placement, and
   * committing against an application that may still be declined would hold
   * money against something that never happens. A learner-level grant with no
   * placement is supported by the model and is not offered here.
   */
  const fundableByMarket = new Map<string, FundableLearner[]>();
  for (const application of allApplications) {
    if (!FUNDABLE_STATUSES.has(application.status)) continue;
    const name = studentNameById.get(application.studentId);
    if (!name) continue;
    const list = fundableByMarket.get(application.marketId) ?? [];
    list.push({
      value: `${application.studentId}:${application.id}`,
      label: name,
      meta: application.track === "micro" ? "Micro" : "Standard",
      description: `${STATUS_META[application.status]?.label ?? application.status} · ${marketName(application.marketId)}`,
    });
    fundableByMarket.set(application.marketId, list);
  }

  const liveMarkets = health.filter((h) => h.market.stage === "live");
  const totalBudget = liveMarkets.reduce((s, h) => s + h.allocated, 0);
  const inPause = stalled.filter((s) => s.inPause).length;

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <PageHeader
        dark
        eyebrow="Program administrator"
        title="Network Operations"
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
              <thead className="border-b border-line">
                <tr>
                  <Th>Student</Th>
                  <Th>Opportunity</Th>
                  <Th>State</Th>
                  <Th>Waiting on</Th>
                  <Th>Dwell</Th>
                </tr>
              </thead>
              <tbody className="row-list divide-y divide-line">
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
      {/*                                                                     */}
      {/* This page invented the zone pattern first, as a bare <section> with */}
      {/* a hand-rolled heading, and then used it exactly once. It is the     */}
      {/* shared primitive now, so every portal groups the same way.          */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Market pipeline"
        description="Board first, then college, then the market opens."
      >
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
                      label={`${h.market.name} launch progress`}
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
                      <dl className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-line">
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

                      <div className="mt-5 pt-5 border-t border-line">
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-xs font-bold text-ink-600 uppercase tracking-wider">
                            {h.market.programYear} subsidy allocation
                          </span>
                          <span className="text-xs text-ink-500">
                            <Money value={h.committed} /> of{" "}
                            <Money value={h.allocated} />
                          </span>
                        </div>
                        <ProgressBar
                          value={h.committed}
                          max={h.allocated}
                      label={`${h.market.name} subsidy committed`}
                          tone={
                            h.overcommitted || (h.allocated > 0 && h.committed / h.allocated > 0.8)
                              ? "crit"
                              : "brand"
                          }
                        />
                        <p className="text-xs text-ink-500 mt-1.5">
                          {h.overcommitted ? (
                            <span className="text-crit-700 font-semibold">
                              <Money value={-h.remaining} /> overcommitted
                            </span>
                          ) : (
                            <>
                              <Money value={h.remaining} /> uncommitted
                            </>
                          )}{" "}
                          at ${h.ratePerHour}/hr
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-ink-500 mt-5 pt-5 border-t border-line">
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
      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Vetting + funnel                                                    */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Gatekeeping and conversion"
        description="Who is waiting to join, and how far the ones already here are getting."
      >
      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Card>
          <CardHeader
            level={3}
            icon={<ClipboardCheck className="w-5 h-5" />}
            title="Awaiting vetting"
            subtitle="Nothing transacts until an organization is approved"
          />
          {pendingOrgs.length === 0 ? (
            <Empty>No organizations waiting.</Empty>
          ) : (
            <ul className="row-list divide-y divide-line">
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
                  <div className="flex flex-wrap items-center justify-end gap-2">
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
                    {/* Vetting is the gate everything else depends on: an
                        unapproved organization cannot post, take applications,
                        or have hours approved against it. Until this queue
                        could move, that sentence in the subtitle was not
                        true of anything. */}
                    <TransitionActions
                      id={org.id}
                      action={organizationLifecycle}
                      subject={org.name}
                      confirm={ORGANIZATION_CONFIRM}
                      transitions={organizationMachine
                        .available(admin, { organization: org })
                        .map((t) => ({ to: t.to, label: t.label }))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            level={3}
            icon={<TrendingUp className="w-5 h-5" />}
            title="Funnel"
            subtitle={`Applications in the pause have been waiting ${pauseDays} days on average`}
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
                      label={`${stage.label} funnel stage`}
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

        {/* -------------------------------------------------------------- */}
        {/* The stage after the funnel's last one.                          */}
        {/*                                                                 */}
        {/* Every number above this card measures whether placements work.  */}
        {/* This is the only one that measures whether the venture does —   */}
        {/* and it is read-only here on purpose: the administrator watches  */}
        {/* five markets, and the college is the party that makes the call. */}
        {/* What an operator needs from this screen is to see where the     */}
        {/* follow-up is not happening.                                     */}
        {/* -------------------------------------------------------------- */}
        <Card>
          <CardHeader
            level={3}
            icon={<Compass className="w-5 h-5" />}
            title="Where they went"
            subtitle="The measure the lifecycle stops short of — employment in the region after the experience"
          />
          <div className="px-6 py-5 space-y-4">
            <div className="flex flex-wrap gap-6">
              <Stat
                label="Stayed in the region"
                value={
                  outcomes.regionalRate === null
                    ? "—"
                    : `${Math.round(outcomes.regionalRate * 100)}%`
                }
                hint={
                  outcomes.regionalRate === null
                    ? "Nothing measured yet"
                    : `${outcomes.regional} of ${outcomes.measured} measured`
                }
              />
              <Stat
                label="Not yet asked"
                value={String(outcomes.unmeasured)}
                hint="Finished placements with no follow-up"
                tone={outcomes.unmeasured > outcomes.measured ? "warn" : "neutral"}
              />
            </div>

            {outcomes.measured === 0 ? (
              <Empty>
                No follow-ups recorded. The rate stays blank rather than reading
                zero — an unworked queue is not a result.
              </Empty>
            ) : (
              <div className="space-y-3">
                {outcomes.byKind.map((kind) => (
                  <div key={kind.kind}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-sm text-ink-700">{kind.label}</span>
                      <span className="text-sm font-bold text-ink-950 tabular">
                        {kind.count}
                      </span>
                    </div>
                    <ProgressBar
                      value={kind.count}
                      max={outcomes.measured || 1}
                      label={`${kind.label} outcomes`}
                      tone={REGIONAL_KINDS.has(kind.kind) ? "good" : "brand"}
                    />
                  </div>
                ))}
              </div>
            )}

            <Assumption>
              One observation per learner, most recent first — a learner followed
              up twice is one learner. The rate is over learners measured, not
              over everyone who finished, so an unworked queue never reads as a
              programme that fails to place people (Q23).
            </Assumption>
          </div>
        </Card>
      </div>
      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Funding — the thing the venture actually sells.                     */}
      {/*                                                                     */}
      {/* Every figure here used to be one number on one market: a board's     */}
      {/* allocation at a board's rate. The service being sold is coordinating */}
      {/* several sources onto one placement, and until these rows existed the */}
      {/* product could describe that on its marketing pages and not depict it */}
      {/* anywhere. An allocation is also expected to move — a supplemental    */}
      {/* award, a rescission — so adjusting one is a write with a reason      */}
      {/* rather than a fixture edit.                                          */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Funding"
        description="Every fund in the network, what it has left, and who it has reached. Allocations change during a program year; changing one here records why."
      >
        <Card>
          <CardHeader
            level={3}
            icon={<HandCoins className="w-5 h-5" />}
            title="Funds and commitments"
            subtitle="Wage subsidy leads each market; everything under it is money the board is not paying"
          />
          {fundBalances.length === 0 ? (
            <Empty>No funds have been opened yet.</Empty>
          ) : (
            <ul className="row-list divide-y divide-line">
              {fundBalances.map((balance) => (
                <li key={balance.source.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-ink-950">
                          {balance.source.name}
                        </span>
                        <Badge
                          tone={
                            balance.source.purpose === "wage_subsidy" ? "brand" : "neutral"
                          }
                        >
                          {fundPurposeLabel(balance.source.purpose)}
                        </Badge>
                        {balance.overcommitted && <Badge tone="crit">Overcommitted</Badge>}
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {marketName(balance.source.marketId)} ·{" "}
                        {organizationName(balance.source.sponsorOrgId)} ·{" "}
                        {balance.liveCommitments} learner
                        {balance.liveCommitments === 1 ? "" : "s"}
                        {balance.source.ratePerHour
                          ? ` · $${balance.source.ratePerHour}/hr`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p
                          className={`text-sm font-bold tabular ${
                            balance.remaining < 0 ? "text-crit-700" : "text-ink-950"
                          }`}
                        >
                          <Money value={balance.remaining} />
                        </p>
                        <p className="text-xs text-ink-500">
                          of <Money value={balance.source.allocated} />
                        </p>
                      </div>
                      {balance.source.purpose !== "wage_subsidy" && (
                        <AwardFunds
                          sourceId={balance.source.id}
                          fundName={balance.source.name}
                          remaining={balance.remaining}
                          learners={fundableByMarket.get(balance.source.marketId) ?? []}
                          action={adminAwardFunds}
                        />
                      )}
                      <AdjustAllocation
                        sourceId={balance.source.id}
                        fundName={balance.source.name}
                        allocated={balance.source.allocated}
                        ratePerHour={balance.source.ratePerHour}
                        committed={balance.committed}
                        action={adminAdjustAllocation}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <ProgressBar
                      value={Math.min(balance.committed, balance.source.allocated)}
                      max={balance.source.allocated || 1}
                      label={`${balance.source.name} committed`}
                      tone={balance.overcommitted ? "crit" : "brand"}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="px-6 pb-5">
            <Assumption>
              Wage subsidy is reported separately from everything else rather
              than summed with it. A total mixing public and philanthropic
              dollars is the one number neither funder would accept.
            </Assumption>
          </div>
        </Card>
      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Mentorship, which is the one form the administrator can move        */}
      {/* directly. A market whose college has not made an introduction is    */}
      {/* exactly the case an operator exists to unstick, and that is not an  */}
      {/* override — every check the college's path runs, this one runs too.  */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Mentors waiting for a student"
        description="Employers offering time that nobody has been introduced to yet. Across every market, which is the view only this console has."
      >
        <Card>
          <CardHeader
            level={3}
            icon={<HandHeart className="w-5 h-5" />}
            title="Open mentorship offers"
            subtitle="No wage, no credit, no board clearance — an hour of somebody's time"
          />
          {openMentorships.length === 0 ? (
            <Empty>No employer is currently offering to mentor.</Empty>
          ) : (
            <ul className="row-list divide-y divide-line">
              {openMentorships.map((offer) => {
                const free = placesLeft(offer, pairingsByOffer.get(offer.id) ?? []);
                return (
                  <li
                    key={offer.id}
                    className="px-6 py-4 flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-ink-950">
                          {offer.mentorName}
                        </span>
                        <span className="text-xs text-ink-500">{offer.mentorRole}</span>
                        <Badge tone="brand">{mentorshipFormatLabel(offer.format)}</Badge>
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {organizationName(offer.businessId)} ·{" "}
                        {marketName(offer.marketId)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-xs text-ink-500 whitespace-nowrap">
                        {free} of {offer.capacity} place{offer.capacity === 1 ? "" : "s"}{" "}
                        free
                      </span>
                      <IntroduceStudent
                        offerId={offer.id}
                        mentorName={offer.mentorName}
                        employerName={organizationName(offer.businessId)}
                        formatLabel={mentorshipFormatLabel(offer.format)}
                        placesLeft={free}
                        students={introducibleIn(offer.marketId).filter(
                          (student) =>
                            !(pairingsByOffer.get(offer.id) ?? []).some(
                              (p) =>
                                p.studentId === student.id &&
                                p.status === "introduced",
                            ),
                        )}
                        action={adminIntroduceStudent}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageSection>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-brand-700" aria-hidden="true" />
            <div>
              <p className="font-bold text-sm text-ink-950">
                Every state change is written to an immutable audit log
              </p>
              <p className="text-xs text-ink-500 mt-0.5">
                Which is also what makes this reporting free rather than computed ad hoc
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href={`${PORTAL_PATH.admin}/audit`}
              className="text-sm font-bold text-brand-700 hover:text-ink-950 flex items-center gap-1.5"
            >
              View audit log <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            {/* The audit log says what changed; the outbox says whether anyone
                was told. A placement stalls on the second, not the first. */}
            <Link
              href={`${PORTAL_PATH.admin}/outbox`}
              className="text-sm font-bold text-brand-700 hover:text-ink-950 flex items-center gap-1.5"
            >
              Notification outbox{" "}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
