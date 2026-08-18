import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CircleDollarSign,
  GraduationCap,
  Landmark,
  School,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge, Card, Money } from "@/components/ui";
import { repositories } from "@/data/memory";
import { systemContext } from "@/auth/system";
import { allMarketHealth } from "@/lib/queries";

export default async function LandingPage() {
  // Public totals are a system read, not somebody's session — naming it that
  // way keeps it from looking like an administrator context leaking onto a
  // page anyone can load.
  const admin = systemContext();
  const health = await allMarketHealth(admin);
  const live = health.filter((h) => h.market.stage === "live");
  const upcoming = health.filter((h) => h.market.stage !== "live");
  const credits = (await repositories.creditAwards.list(admin))
    .filter((c) => c.status === "granted")
    .reduce((s, c) => s + c.creditHours, 0);
  const placements = health.reduce((s, h) => s + h.placements, 0);
  const businesses = health.reduce((s, h) => s + h.activeBusinesses, 0);

  return (
    <div className="pb-4">
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative overflow-hidden">
        {/* Atmosphere behind the fold. The hero was previously the same flat
            fill as the rest of the document, so the page opened on nothing —
            a headline with no ground under it and no horizon behind it. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-18rem] h-[34rem] w-[64rem] -translate-x-1/2 rounded-full bg-brand-200/35 blur-[120px]" />
          <div className="absolute left-[8%] top-24 h-72 w-72 rounded-full bg-micro-100/50 blur-[100px]" />
        </div>

        <div className="relative px-6 pt-16 pb-20 max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-brand-200 px-4 py-1.5 rounded-full text-brand-700 text-xs font-bold shadow-e1">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            Kansas colleges, employers, and local workforce boards
          </div>

          <h1 className="mt-8 text-[2.75rem] md:text-[4.25rem] font-black text-ink-950 tracking-[-0.03em] leading-[1.02] text-balance max-w-4xl mx-auto">
            Paid internships that earn{" "}
            {/* Colour alone. An underline here — even a tapered one — reads as
                a hyperlink at display size, which is the one thing a headline
                phrase must not look like. */}
            <span className="text-brand-700">real academic credit</span>
          </h1>

          <p className="mt-7 text-lg text-ink-600 max-w-2xl mx-auto leading-relaxed text-pretty">
            One program connecting students, local businesses, colleges, and workforce
            boards — so an internship gets funded, supervised, and credited without anyone
            chasing paperwork.
          </p>

          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/student"
              className="group bg-gradient-to-b from-brand-600 to-brand-700 text-white font-bold px-7 py-3.5 rounded-panel shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_4px_16px_-4px_rgb(3_105_161/0.55)] hover:shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_8px_24px_-6px_rgb(3_105_161/0.6)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2.5"
            >
              Find an internship
              <ArrowRight
                className="w-5 h-5 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/business"
              className="bg-surface text-ink-950 border border-line-strong font-bold px-7 py-3.5 rounded-panel shadow-e2 hover:shadow-e3 hover:border-ink-400 hover:-translate-y-0.5 active:translate-y-0 transition-all"
            >
              Host an intern
            </Link>
          </div>

          {/* One instrument, four readings — not four floating boxes.
              Separate tiles gave each number its own frame and its own shadow,
              which made a summary read as a scoreboard of unrelated facts. */}
          <dl className="mt-16 mx-auto max-w-4xl grid grid-cols-2 md:grid-cols-4 rounded-panel bg-surface/90 backdrop-blur-sm border border-line shadow-e3 divide-x divide-y md:divide-y-0 divide-line overflow-hidden">
            {[
              { label: "Live markets", value: String(live.length) },
              { label: "Placements", value: String(placements) },
              { label: "Participating employers", value: String(businesses) },
              { label: "Credit hours granted", value: String(credits) },
            ].map((stat) => (
              <div key={stat.label} className="px-5 py-6 text-center">
                <dd className="text-4xl font-black text-ink-950 tabular leading-none">
                  {stat.value}
                </dd>
                <dt className="text-[0.7rem] font-bold text-brand-700 mt-2.5 uppercase tracking-[0.1em] leading-tight">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The employer pitch — the reimbursement is the whole reason          */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="relative overflow-hidden rounded-hero bg-ink-950 text-white px-8 py-12 md:px-14 md:py-16 shadow-dark">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 -right-24 h-[26rem] w-[26rem] rounded-full bg-brand-500/20 blur-[100px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/50 to-transparent"
          />

          <div className="relative grid gap-12 md:grid-cols-2 md:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-400/10 px-3 py-1 text-brand-400 text-xs font-bold uppercase tracking-[0.12em] ring-1 ring-inset ring-brand-400/25">
                <CircleDollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                For employers
              </span>
              <h2 className="mt-5 text-3xl md:text-[2.6rem] font-black tracking-[-0.02em] leading-[1.08] text-balance">
                Your local workforce board pays you{" "}
                <span className="text-brand-400">$20 an hour</span> to host an intern
              </h2>
              <p className="mt-5 text-ink-400 leading-relaxed text-pretty">
                You pay the wage. After a short board interview clears your candidate, the
                board reimburses you $20 for every hour they work. A full semester
                internship is roughly <Money value={4200} /> back.
              </p>
              <Link
                href="/business"
                className="group mt-8 inline-flex items-center gap-2 bg-white text-ink-950 font-bold px-6 py-3 rounded-card shadow-[0_4px_14px_-4px_rgb(0_0_0/0.5)] hover:bg-brand-400 hover:text-ink-950 transition-colors"
              >
                See how it works
                <ArrowRight
                  className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </div>

            {/* A sequence, drawn as one. The steps were four detached tiles,
                which said nothing about their being ordered — the connector is
                what turns a list into a process. */}
            <ol className="relative space-y-3">
              <span
                aria-hidden="true"
                className="absolute left-[2.05rem] top-6 bottom-6 w-px bg-gradient-to-b from-brand-400/50 via-white/15 to-transparent"
              />
              {[
                { step: "Post the role", detail: "Your college partner will help you scope it" },
                { step: "Pick a candidate", detail: "Sorted by skill match, never filtered" },
                { step: "Board clears them", detail: "One short interview, booked in the app" },
                { step: "Get reimbursed", detail: "$20/hour against approved timesheets" },
              ].map((item, i) => (
                <li
                  key={item.step}
                  className="relative flex gap-4 items-center bg-white/[0.06] rounded-card px-5 py-4 ring-1 ring-inset ring-white/10 backdrop-blur-sm"
                >
                  <span className="relative z-10 shrink-0 grid place-items-center w-8 h-8 rounded-full bg-brand-500 text-white font-black tabular text-xs shadow-[0_2px_8px_-2px_rgb(14_165_233/0.8)]">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-bold text-sm">{item.step}</p>
                    <p className="text-xs text-ink-400 mt-0.5">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Two tracks                                                          */}
      {/* ------------------------------------------------------------------ */}
      {/* On white, full-bleed. Five sections on one continuous grey was most
          of why this page read as a single undifferentiated scroll; banding
          alternate sections gives the eye a reason to register a boundary. */}
      <section className="bg-surface border-y border-line py-24">
        <div className="max-w-6xl mx-auto px-6">
          <SectionIntro
            eyebrow="Two tracks"
            title="Two ways to earn credit"
            lede="A full semester, or a project you can finish in a fortnight."
          />

          <div className="grid gap-6 md:grid-cols-2 mt-12">
            <Card elevation="floating" className="relative overflow-hidden p-8">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-brand-700"
              />
              <Badge tone="brand">Standard · 3 credits</Badge>
              <h3 className="text-2xl font-black text-ink-950 mt-4 tracking-tight">
                Semester internship
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                An ongoing role with a supervisor, 12–15 weeks, around 135–150 hours. Paid
                hourly, subsidised by your local workforce board, and worth three credit
                hours.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-ink-600 border-t border-line pt-5">
                {[
                  "Hourly wage, reimbursed to the employer at $20/hr",
                  "Board interview determines your eligibility once",
                  "Supervisor evaluation and logged hours",
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </Card>

            <Card elevation="floating" className="relative overflow-hidden p-8">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-micro-600 to-micro-700"
              />
              <Badge tone="micro">
                <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Micro · 1 credit
              </Badge>
              <h3 className="text-2xl font-black text-ink-950 mt-4 tracking-tight">
                Project sprint
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                A scoped 5–40 hour project with a fixed fee and a real deliverable, finished
                in a week to a month. No interview, no semester commitment — stack a few and
                they add up to credit.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-ink-600 border-t border-line pt-5">
                {[
                  "Fixed project fee, paid on acceptance",
                  "Starts in days — no board clearance needed",
                  "Hours bank toward a credit as you complete projects",
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-micro-600"
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Four participants                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <SectionIntro
          eyebrow="Who is involved"
          title="Four participants, one workflow"
          lede="Everyone sees the same placement from their own side."
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mt-12">
          {[
            {
              href: "/student",
              icon: GraduationCap,
              title: "Students",
              copy: "One profile, reused for every application. Earn a wage and credit at the same time.",
            },
            {
              href: "/business",
              icon: Building2,
              title: "Employers",
              copy: "Post roles, review matched candidates, and get reimbursed $20/hr for the hours they work.",
            },
            {
              href: "/college",
              icon: School,
              title: "Colleges",
              copy: "Verify students, help employers scope good postings, and grant the credit.",
            },
            {
              href: "/board",
              icon: Landmark,
              title: "Workforce boards",
              copy: "Determine eligibility, authorize funding, and track the allocation you deploy.",
            },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.href} href={card.href} className="group block h-full">
                <Card interactive className="p-6 h-full flex flex-col">
                  <span className="w-12 h-12 bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 rounded-card flex items-center justify-center mb-5 ring-1 ring-brand-200/70 shadow-e1 transition-colors group-hover:from-brand-600 group-hover:to-brand-700 group-hover:text-white group-hover:ring-brand-700">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-extrabold text-ink-950 tracking-tight">
                    {card.title}
                  </h3>
                  <p className="text-sm text-ink-500 mt-2 leading-relaxed flex-1 text-pretty">
                    {card.copy}
                  </p>
                  <span className="mt-5 pt-4 border-t border-line text-sm font-bold text-brand-700 group-hover:text-ink-950 flex items-center gap-1.5 transition-colors">
                    Open portal
                    <ArrowRight
                      className="w-4 h-4 transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Where the program runs                                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-surface border-y border-line py-24">
        <div className="max-w-6xl mx-auto px-6">
          <SectionIntro
            eyebrow="Rollout"
            title="Launching market by market"
            lede="Each market starts with a local workforce board, then a college partner, then opens to students and employers."
          />

          {/* A live market and a market that does not exist yet are not peers,
              and rendering them as one uniform grid said they were — five
              identical cards, one of which happened to say "Live". Live
              markets are given the weight; the rest are a roster. */}
          <div className="mt-12 space-y-8">
            <div className="grid gap-5 md:grid-cols-2">
              {live.map((h) => (
                <Card
                  key={h.market.id}
                  elevation="floating"
                  className="relative overflow-hidden p-7"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-1 bg-good-600"
                  />
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-black text-ink-950 tracking-tight">
                        {h.market.city}
                      </h3>
                      <p className="text-sm text-ink-500 mt-0.5">{h.market.name}</p>
                    </div>
                    <Badge tone="good">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-good-600"
                      />
                      Live
                    </Badge>
                  </div>
                  <dl className="mt-6 pt-5 border-t border-line grid grid-cols-3 gap-4">
                    {[
                      { label: "Students", value: h.activeStudents },
                      { label: "Employers", value: h.activeBusinesses },
                      { label: "Placed", value: h.placements },
                    ].map((figure) => (
                      <div key={figure.label}>
                        <dd className="text-2xl font-black text-ink-950 tabular leading-none">
                          {figure.value}
                        </dd>
                        <dt className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.1em] mt-1.5">
                          {figure.label}
                        </dt>
                      </div>
                    ))}
                  </dl>
                </Card>
              ))}
            </div>

            {upcoming.length > 0 && (
              <div>
                <p className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em] mb-4">
                  Next up
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {upcoming.map((h) => (
                    <Card
                      key={h.market.id}
                      elevation="sunken"
                      className="px-5 py-4 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <h3 className="font-bold text-ink-700 truncate">
                          {h.market.city}
                        </h3>
                        <p className="text-xs text-ink-500 truncate">{h.market.name}</p>
                      </div>
                      <span className="text-[0.7rem] font-semibold text-ink-500 uppercase tracking-wider shrink-0">
                        Soon
                      </span>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The heading block every section shares.
 *
 * Written once because the page previously repeated `centered h2 + grey
 * paragraph` five times with no eyebrow and no rule — identical openings are
 * what made five different subjects scan as one continuous list. The eyebrow
 * is the cheap part that tells the reader they have crossed into a new
 * subject before they have read the heading.
 */
function SectionIntro({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <span className="inline-flex items-center gap-2 text-[0.7rem] font-bold text-brand-700 uppercase tracking-[0.14em]">
        <span aria-hidden="true" className="h-px w-6 bg-brand-200" />
        {eyebrow}
        <span aria-hidden="true" className="h-px w-6 bg-brand-200" />
      </span>
      <h2 className="text-3xl md:text-4xl font-black text-ink-950 text-balance tracking-[-0.02em] mt-3">
        {title}
      </h2>
      <p className="text-ink-600 mt-3 text-pretty leading-relaxed">{lede}</p>
    </div>
  );
}
