import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui";
import { PageIntro, Section } from "@/app/_site/parts";
import { siteTitle } from "@/brand";
import { DEMO_ROOT } from "@/routes";

export const metadata: Metadata = {
  title: siteTitle("Approach"),
  description:
    "How a career-connected opportunity gets built in a rural community — the sequence a market goes through, and what has to be true before a learner can be placed.",
};

/**
 * How the work actually runs.
 *
 * Written for the reader who has understood the pitch and wants to know
 * whether there is a method behind it. The honest answer is that most of the
 * value is in a sequence nobody currently owns, so the page shows the
 * sequence.
 */
export default function ApproachPage() {
  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 pt-16">
        <PageIntro
          eyebrow="Approach"
          title="A community does not need another program. It needs the connections made."
          lede="Most of what a career-connected placement requires already exists somewhere in a rural county. The work is sequencing it — and doing the parts nobody has been assigned."
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* How a community comes online                                        */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="How a community comes online"
        lede="In order, because the order is what makes it work. Funding first, because funding is what makes participation realistic for a small employer — and an education partner joins a program that already has money behind it far more readily than one that does not."
      >
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 list-none">
          {[
            {
              n: "1",
              title: "Funding partner",
              copy: "A workforce or funding partner commits resources that can offset wages, credit costs, or the barriers that stop someone participating.",
            },
            {
              n: "2",
              title: "Education partner",
              copy: "A college or training provider commits to verifying learners, helping employers scope work, and granting credit where credit applies.",
            },
            {
              n: "3",
              title: "Employers",
              copy: "Direct outreach to local employers, then the real work: turning a stated talent need into an opportunity somebody can actually take.",
            },
            {
              n: "4",
              title: "Learners",
              copy: "Opportunities reach the people they were written for, with the funding and support that makes taking one possible already attached.",
            },
          ].map((step) => (
            // An `li` around the card rather than the card itself: this is a
            // real sequence — the order is the argument the section makes —
            // and an `ol` whose children are divs is a list a screen reader
            // is told about and then cannot read.
            <li key={step.n}>
              <Card elevation="floating" className="p-6 h-full">
                <span className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-b from-brand-600 to-brand-700 text-white font-black tabular text-sm shadow-[0_2px_8px_-2px_rgb(14_165_233/0.7)]">
                  {step.n}
                </span>
                <h3 className="text-lg font-extrabold text-ink-950 tracking-tight mt-4">
                  {step.title}
                </h3>
                <p className="text-sm text-ink-600 mt-2 leading-relaxed text-pretty">
                  {step.copy}
                </p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Where placements die                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="The gap we exist to close"
        lede="A placement rarely fails because somebody says no. It fails in the pause after everybody has said yes."
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-start">
          <div className="space-y-4">
            <p className="text-ink-600 leading-relaxed text-pretty">
              An employer and a learner agree they want to work together. Then
              everything stops. Somebody has to determine whether the wage can be
              subsidised, and that determination needs an interview the learner
              has to book themselves — often with an organization they have never
              heard of, for a process nobody has explained to them.
            </p>
            <p className="text-ink-600 leading-relaxed text-pretty">
              Every day in that gap is a day the learner can disengage or the
              employer can move on. The funding stays committed against a
              placement that never happens. Nobody involved did anything wrong;
              the parties each held one piece and never connected.
            </p>
            <p className="text-ink-600 leading-relaxed text-pretty">
              Compressing that pause — surfacing it the moment two parties agree,
              showing what has to happen next, and telling all three sides where
              things stand — is the single most valuable thing this coordination
              does.
            </p>
            <Link
              href={DEMO_ROOT}
              className="group inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-ink-950 transition-colors"
            >
              See how the prototype handles it
              <ArrowRight
                className="w-4 h-4 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </div>

          <Card elevation="floating" className="p-7">
            <h3 className="text-lg font-extrabold text-ink-950 tracking-tight">
              The other place it breaks
            </h3>
            <p className="text-sm text-ink-600 mt-3 leading-relaxed text-pretty">
              An employer who wants to host but has never written a job
              description for a student. They are not refusing — they genuinely
              do not know how to scope the work, and there is nobody whose job it
              is to help them. Left alone, that employer quietly stops being an
              employer who hosts.
            </p>
            <p className="text-sm text-ink-600 mt-3 leading-relaxed text-pretty">
              Surfacing them as a queue an education partner can actually work
              turns a lost opportunity into an afternoon of somebody&apos;s time.
            </p>
          </Card>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Forms of experience                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="Career-connected learning takes several forms"
        lede="They differ along a few dimensions — whether the experience is paid and how, whether it carries academic credit, whether it needs funding clearance, and what the learner produces. New forms are configurations of those rather than new systems."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Sustained placements",
              copy: "Internships, apprenticeships, work-study, career and technical education, summer youth programming.",
            },
            {
              title: "Project-based work",
              copy: "Micro-internships, employer-sponsored projects, classroom-industry collaborations, service learning.",
            },
            {
              title: "Exploratory and relational",
              copy: "Job shadows, mentorship, employer engagement with classrooms, and early career exposure.",
            },
          ].map((form) => (
            <Card key={form.title} elevation="floating" className="p-7">
              <h3 className="text-lg font-extrabold text-ink-950 tracking-tight">
                {form.title}
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                {form.copy}
              </p>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-ink-600 leading-relaxed text-pretty">
          The work starts with experiences that carry college-level credit —
          common enough to prove the model and complex enough to test it, because
          they involve every participant, real money, and an academic claim. What
          is built to hold the rest is the architecture underneath, not the first
          release.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Outcome                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="What we are actually measuring"
        lede="Not how many people entered the network. Whether the thing the network exists for happened."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              level: "Learners",
              copy: "Opportunities created and completed, paid experiences, and how many people moved from an experience into continued education or employment.",
            },
            {
              level: "Employers",
              copy: "Employers participating, opportunities created, repeat participation, positions filled, and experiences that converted into a job.",
            },
            {
              level: "Communities",
              copy: "Partners connected, geographic spread of opportunity, outside funding brought into the community, and barriers removed.",
            },
          ].map((m) => (
            <Card key={m.level} elevation="floating" className="p-7">
              <span className="text-[0.7rem] font-bold text-brand-700 uppercase tracking-[0.12em]">
                {m.level}
              </span>
              <p className="text-sm text-ink-600 mt-3 leading-relaxed text-pretty">
                {m.copy}
              </p>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-ink-600 leading-relaxed text-pretty">
          The measure that matters most is the hardest one and takes the longest
          to produce: whether more people who want to build a future close to
          home have a realistic pathway to it, and whether they took it.
        </p>
      </Section>
    </div>
  );
}
