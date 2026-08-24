import Link from "next/link";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Landmark,
  Layers,
  MapPin,
} from "lucide-react";
import { Card } from "@/components/ui";
import { Figure, Section } from "@/app/_site/parts";
import { DEMO_ROOT } from "@/routes";

/**
 * The front door.
 *
 * This used to be the prototype's cover page — a program pitch, two calls to
 * action aimed at students and employers, and four statistics computed from
 * seeded fixtures, all under a banner saying every figure above it was
 * invented. That page had to be honest and impressive at the same time and
 * could not be both.
 *
 * So this one is addressed to the reader who arrives from an application, a
 * business card, or a referral, and it obeys one rule the old page could not:
 * **every number here is real.** The prototype is one click away, at
 * `/demo`, still carrying its banner.
 */
export default function HomePage() {
  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-20rem] h-[34rem] w-[64rem] -translate-x-1/2 rounded-full bg-brand-200/35 blur-[120px]" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 pt-14 pb-14">
          <div className="max-w-4xl">
            <span className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-brand-200 px-4 py-1.5 rounded-full text-brand-700 text-xs font-bold shadow-e1">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              Rural Kansas
            </span>

            {/* Sized to land in three lines at desktop width. At the display
                size this started on it ran to six, which turned the hero into
                a wall of type with the fold below it and nothing else above
                — the statistics that make the claim credible were the part
                nobody scrolled to. */}
            <h1 className="mt-7 text-[2.1rem] md:text-[3.1rem] font-black text-ink-950 tracking-[-0.03em] leading-[1.06] text-balance">
              Rural Kansas does not lack talent, employers, or funding. It lacks
              the <span className="text-brand-700">connections between them</span>.
            </h1>

            <p className="mt-6 text-lg text-ink-600 leading-relaxed text-pretty max-w-2xl">
              We are the connective infrastructure between education, employers,
              workforce partners, funding, and learners — so a career-connected
              opportunity that should exist actually does, and a learner who
              should find it can.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/partners"
                className="group bg-gradient-to-b from-brand-600 to-brand-700 text-white font-bold px-7 py-3.5 rounded-panel shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_4px_16px_-4px_rgb(3_105_161/0.55)] hover:shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_8px_24px_-6px_rgb(3_105_161/0.6)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2.5"
              >
                For communities and institutions
                <ArrowRight
                  className="w-5 h-5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
              <Link
                href="/approach"
                className="bg-surface text-ink-950 border border-line-strong font-bold px-7 py-3.5 rounded-panel shadow-e2 hover:shadow-e3 hover:border-ink-400 hover:-translate-y-0.5 active:translate-y-0 transition-all"
              >
                How it works
              </Link>
            </div>
          </div>

          {/* Four numbers, each of them true today. The page this replaced
              showed placements, employers, and credit hours counted off
              seeded fixtures — impressive-looking figures a reader had no way
              to tell from real ones. */}
          <dl className="mt-14 grid grid-cols-2 md:grid-cols-4 rounded-panel bg-surface/90 backdrop-blur-sm border border-line shadow-e3 divide-x divide-y md:divide-y-0 divide-line overflow-hidden">
            <Figure value="177" says="students surveyed on what actually blocks a placement" />
            <Figure value="4" says="communities in the proving ground, three of them university towns" />
            <Figure value="$20,000" says="already committed to building the partner dashboard" />
            <Figure value="2027" says="when the first phase opens with paying partners" />
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The problem                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="The pieces already exist. Nobody owns the job of connecting them."
        lede="An employer needs talent. A learner needs experience. A college can grant credit. A workforce board may have funding to offset the wage. A community partner may hold the one resource that removes the barrier in the way."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Learners cannot see what is near them",
              copy: "Young people grow up surrounded by viable careers without knowing what those careers are, what they pay, what training they take, or how to get into one. Of 177 students we surveyed, the barriers named most often were the cost of internship credit, not knowing what opportunities existed, scheduling, and too few options close to home.",
            },
            {
              title: "Small employers cannot build the pathway alone",
              copy: "A rural employer may urgently need talent and still lack the staff, the time, or the internal expertise to scope work into something a learner could take on — let alone to navigate the funding that would make hosting affordable.",
            },
            {
              title: "The resources do not meet in the middle",
              copy: "Education, workforce organizations, employers, and funders can operate in the same county, toward the same goal, in separate systems. The opportunity someone needs may already exist close to home without them ever being able to see it, afford it, or reach it.",
            },
          ].map((item) => (
            <Card key={item.title} elevation="floating" className="p-7">
              <h3 className="text-lg font-extrabold text-ink-950 tracking-tight text-balance">
                {item.title}
              </h3>
              <p className="text-sm text-ink-600 mt-3 leading-relaxed text-pretty">
                {item.copy}
              </p>
            </Card>
          ))}
        </div>

        <p className="mt-9 max-w-3xl text-ink-600 leading-relaxed text-pretty">
          That fragmentation is the rural challenge underneath talent retention.
          When people cannot see opportunity close to home, they look elsewhere.
          When employers cannot develop the workforce they need, they cannot
          grow. The goal is not to convince every young person to stay — it is
          to make sure leaving is a choice rather than the result of never
          seeing what was here.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* What we do                                                          */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="What we actually do"
        lede="Not another standalone program. A coordinated service that connects and strengthens what a community already has, and fills the gaps where something is genuinely missing."
      >
        <div className="grid gap-px bg-line border border-line rounded-panel overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Employer outreach", "Finding the employers who would host, and reaching them where they are"],
            ["Opportunity development", "Turning a talent need into work a learner can actually take on"],
            ["Participant recruitment", "Getting the opportunity in front of the people it was written for"],
            ["Matching", "Putting the right learner and the right employer in the same room"],
            ["Funding coordination", "Finding what pays for it — workforce dollars, scholarships, philanthropy"],
            ["Partner referrals", "Handing a need to the organization already equipped to meet it"],
            ["Communication", "Being the party who tells everyone what happens next"],
            ["Ongoing support", "Staying with the placement, because this is where they fall apart"],
          ].map(([title, copy]) => (
            <div key={title} className="bg-surface p-6">
              <h3 className="font-extrabold text-ink-950 tracking-tight">{title}</h3>
              <p className="text-sm text-ink-500 mt-2 leading-relaxed text-pretty">
                {copy}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Who it is for                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="Who this is for"
        lede="Three groups, with different stakes in the same problem."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              icon: Landmark,
              tag: "Our partners",
              title: "Communities and institutions",
              copy: "Colleges, workforce and economic development organizations, and communities responsible for building and keeping a skilled workforce. They are who we work for, and who pays for the service.",
              href: "/partners",
              cta: "See how a partnership works",
            },
            {
              icon: Building2,
              tag: "Who we serve",
              title: "Rural employers",
              copy: "Small and midsized businesses that need talent but have no dedicated HR or internship-program capacity. We help turn a talent need into a real opportunity and find what offsets the cost of hosting.",
              href: "/approach",
              cta: "How an opportunity gets built",
            },
            {
              icon: GraduationCap,
              tag: "Who benefits",
              title: "Learners of all ages",
              copy: "Students, emerging workers, and adults retraining or changing direction. The work begins with credit-bearing internships and is built to extend earlier into career exposure and later into apprenticeship and reskilling.",
              href: "/evidence",
              cta: "What we have learned so far",
            },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.title} elevation="floating" className="p-7 flex flex-col">
                <span className="w-11 h-11 bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 rounded-card flex items-center justify-center ring-1 ring-brand-200/70 shadow-e1">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="mt-5 text-[0.7rem] font-bold text-brand-700 uppercase tracking-[0.12em]">
                  {card.tag}
                </span>
                <h3 className="text-lg font-extrabold text-ink-950 tracking-tight mt-1.5">
                  {card.title}
                </h3>
                <p className="text-sm text-ink-600 mt-2.5 leading-relaxed flex-1 text-pretty">
                  {card.copy}
                </p>
                <Link
                  href={card.href}
                  className="group mt-5 pt-4 border-t border-line text-sm font-bold text-brand-700 hover:text-ink-950 flex items-center gap-1.5 transition-colors"
                >
                  {card.cta}
                  <ArrowRight
                    className="w-4 h-4 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </Link>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* The proving ground                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="The proving ground"
        lede="Four Kansas communities, chosen so that succeeding in all four means something. Three are university towns. The fourth deliberately is not."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { city: "Pittsburg", region: "Southeast Kansas", note: "Where the work started, and where the existing relationships are" },
            { city: "Emporia", region: "Flint Hills", note: "A second university community, with a different regional employer mix" },
            { city: "Hays", region: "Smoky Hill", note: "A third, far enough west to test a genuinely different labour market" },
            { city: "Beloit", region: "North Central", note: "The outlier — a tenth the size, anchored on a technical and community college rather than a university" },
          ].map((market, i) => (
            <Card key={market.city} elevation="floating" className="p-6 relative overflow-hidden">
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-1 ${i === 3 ? "bg-micro-600" : "bg-brand-600"}`}
              />
              <p className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em]">
                {market.region}
              </p>
              <h3 className="text-xl font-black text-ink-950 tracking-tight mt-1">
                {market.city}
              </h3>
              <p className="text-sm text-ink-600 mt-3 leading-relaxed text-pretty">
                {market.note}
              </p>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-ink-600 leading-relaxed text-pretty">
          Three university towns can prove that the model works next to a
          university. They cannot show whether it travels, because each has the
          same anchor institution, the same student supply, and roughly the same
          employer mix. A market a tenth their size is the one that tests
          whether this is a replicable system or a locally successful program.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* The prototype                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 pb-8">
        <div className="relative overflow-hidden rounded-hero bg-ink-950 text-white px-8 py-12 md:px-14 md:py-14 shadow-dark">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 -right-24 h-[26rem] w-[26rem] rounded-full bg-brand-500/20 blur-[100px]"
          />
          <div className="relative grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-400/10 px-3 py-1 text-brand-400 text-xs font-bold uppercase tracking-[0.12em] ring-1 ring-inset ring-brand-400/25">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                Working prototype
              </span>
              <h2 className="mt-5 text-2xl md:text-[2.1rem] font-black tracking-[-0.02em] leading-[1.12] text-balance">
                The software already exists, and you can click through all of it
              </h2>
              <p className="mt-4 text-ink-400 leading-relaxed text-pretty max-w-xl">
                Five portals over one workflow — learner, employer, college,
                workforce board, and the administrator&apos;s console. It runs on
                invented organizations and fictional figures, and it says so on
                every screen. It is how we show what the coordination actually
                looks like rather than describing it.
              </p>
            </div>
            <Link
              href={DEMO_ROOT}
              className="group inline-flex items-center justify-center gap-2 bg-white text-ink-950 font-bold px-6 py-3.5 rounded-card shadow-[0_4px_14px_-4px_rgb(0_0_0/0.5)] hover:bg-brand-400 transition-colors md:justify-self-end"
            >
              Open the prototype
              <ArrowRight
                className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
