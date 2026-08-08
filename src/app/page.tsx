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

export default function LandingPage() {
  // Public totals are a system read, not somebody's session — naming it that
  // way keeps it from looking like an administrator context leaking onto a
  // page anyone can load.
  const admin = systemContext();
  const health = allMarketHealth(admin);
  const live = health.filter((h) => h.market.stage === "live");
  const credits = repositories.creditAwards
    .list(admin)
    .filter((c) => c.status === "granted")
    .reduce((s, c) => s + c.creditHours, 0);
  const placements = health.reduce((s, h) => s + h.placements, 0);
  const businesses = health.reduce((s, h) => s + h.activeBusinesses, 0);

  return (
    <div className="space-y-24 pb-12">
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="pt-14 px-6 max-w-6xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 px-4 py-2 rounded-full text-brand-700 text-xs font-bold">
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          Kansas colleges, employers, and local workforce boards
        </div>

        <h1 className="mt-8 text-4xl md:text-6xl font-black text-ink-950 tracking-tight leading-[1.05] text-balance max-w-4xl mx-auto">
          Paid internships that earn{" "}
          <span className="text-brand-500">real academic credit</span>
        </h1>

        <p className="mt-6 text-lg text-ink-600 max-w-2xl mx-auto">
          One program connecting students, local businesses, colleges, and workforce
          boards — so an internship gets funded, supervised, and credited without anyone
          chasing paperwork.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/student"
            className="bg-brand-500 text-white font-bold px-7 py-3.5 rounded-2xl hover:bg-ink-950 transition-colors shadow-lg shadow-brand-500/25 flex items-center gap-2.5"
          >
            Find an internship <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </Link>
          <Link
            href="/business"
            className="bg-white text-ink-950 border border-ink-200 font-bold px-7 py-3.5 rounded-2xl hover:bg-ink-50 transition-colors shadow-sm"
          >
            Host an intern
          </Link>
        </div>

        <dl className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {[
            { label: "Live markets", value: String(live.length) },
            { label: "Placements", value: String(placements) },
            { label: "Participating employers", value: String(businesses) },
            { label: "Credit hours granted", value: String(credits) },
          ].map((stat) => (
            <Card key={stat.label} className="p-6 text-center">
              <dd className="text-3xl font-black text-ink-950 tabular">{stat.value}</dd>
              <dt className="text-xs font-semibold text-brand-600 mt-1.5 uppercase tracking-wider">
                {stat.label}
              </dt>
            </Card>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The employer pitch — the reimbursement is the whole reason          */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="rounded-3xl bg-ink-950 text-white px-8 py-12 md:px-14 md:py-14">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <span className="inline-flex items-center gap-2 text-brand-400 text-xs font-bold uppercase tracking-widest">
                <CircleDollarSign className="w-4 h-4" aria-hidden="true" />
                For employers
              </span>
              <h2 className="mt-4 text-3xl md:text-4xl font-black tracking-tight text-balance">
                Your local workforce board pays you{" "}
                <span className="text-brand-400">$20 an hour</span> to host an intern
              </h2>
              <p className="mt-5 text-ink-400 leading-relaxed">
                You pay the wage. After a short board interview clears your candidate, the
                board reimburses you $20 for every hour they work. A full semester
                internship is roughly <Money value={4200} /> back.
              </p>
              <Link
                href="/business"
                className="mt-7 inline-flex items-center gap-2 bg-brand-500 text-white font-bold px-6 py-3 rounded-xl hover:bg-white hover:text-ink-950 transition-colors"
              >
                See how it works <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="space-y-3">
              {[
                { step: "Post the role", detail: "Your college partner will help you scope it" },
                { step: "Pick a candidate", detail: "Sorted by skill match, never filtered" },
                { step: "Board clears them", detail: "One short interview, booked in the app" },
                { step: "Get reimbursed", detail: "$20/hour against approved timesheets" },
              ].map((item, i) => (
                <div
                  key={item.step}
                  className="flex gap-4 items-start bg-white/5 rounded-xl px-5 py-4 border border-white/10"
                >
                  <span className="text-brand-400 font-black tabular text-sm mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-bold text-sm">{item.step}</p>
                    <p className="text-xs text-ink-400 mt-0.5">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Two tracks                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-black text-ink-950 text-balance">
            Two ways to earn credit
          </h2>
          <p className="text-ink-600 mt-2">
            A full semester, or a project you can finish in a fortnight.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-8">
            <Badge tone="brand">Standard · 3 credits</Badge>
            <h3 className="text-2xl font-black text-ink-950 mt-4">
              Semester internship
            </h3>
            <p className="text-sm text-ink-600 mt-2 leading-relaxed">
              An ongoing role with a supervisor, 12–15 weeks, around 135–150 hours. Paid
              hourly, subsidised by your local workforce board, and worth three credit
              hours.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-ink-600">
              {[
                "Hourly wage, reimbursed to the employer at $20/hr",
                "Board interview determines your eligibility once",
                "Supervisor evaluation and logged hours",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="text-brand-500 mt-1" aria-hidden="true">
                    ●
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-8 border-micro-100">
            <Badge tone="micro">
              <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Micro · 1 credit
            </Badge>
            <h3 className="text-2xl font-black text-ink-950 mt-4">Project sprint</h3>
            <p className="text-sm text-ink-600 mt-2 leading-relaxed">
              A scoped 5–40 hour project with a fixed fee and a real deliverable, finished
              in a week to a month. No interview, no semester commitment — stack a few and
              they add up to credit.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-ink-600">
              {[
                "Fixed project fee, paid on acceptance",
                "Starts in days — no board clearance needed",
                "Hours bank toward a credit as you complete projects",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="text-micro-600 mt-1" aria-hidden="true">
                    ●
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Four participants                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-black text-ink-950 text-balance">
            Four participants, one workflow
          </h2>
          <p className="text-ink-600 mt-2">
            Everyone sees the same placement from their own side.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
              <Link key={card.href} href={card.href} className="group">
                <Card className="p-6 h-full flex flex-col hover:shadow-lg transition-shadow">
                  <span className="w-11 h-11 bg-brand-50 text-brand-500 rounded-2xl flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-extrabold text-ink-950">{card.title}</h3>
                  <p className="text-sm text-ink-500 mt-2 leading-relaxed flex-1">
                    {card.copy}
                  </p>
                  <span className="mt-4 text-sm font-bold text-brand-600 group-hover:text-ink-950 flex items-center gap-1.5 transition-colors">
                    Open portal <ArrowRight className="w-4 h-4" aria-hidden="true" />
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
      <section className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-black text-ink-950 text-balance">
            Launching market by market
          </h2>
          <p className="text-ink-600 mt-2 max-w-2xl mx-auto">
            Each market starts with a local workforce board, then a college partner, then
            opens to students and employers.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {health.map((h) => (
            <Card key={h.market.id} className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-ink-950">{h.market.city}</h3>
                  <p className="text-xs text-ink-500 mt-0.5">{h.market.name}</p>
                </div>
                <Badge tone={h.market.stage === "live" ? "good" : "neutral"}>
                  {h.market.stage === "live" ? "Live" : "Coming soon"}
                </Badge>
              </div>
              {h.market.stage === "live" && (
                <p className="text-xs text-ink-500 mt-4">
                  {h.activeStudents} students · {h.activeBusinesses} employers ·{" "}
                  {h.placements} placed
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
