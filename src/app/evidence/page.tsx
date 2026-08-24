import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui";
import { Figure, PageIntro, Section } from "@/app/_site/parts";
import { siteTitle } from "@/brand";
import { DEMO_ROOT } from "@/routes";

export const metadata: Metadata = {
  title: siteTitle("Evidence"),
  description:
    "What has been tested, what learners said blocks them, what is already committed, and what is still an open question.",
};

/**
 * What we actually know, and how we know it.
 *
 * The most useful page on this site for a funder, and the one that has to be
 * most careful. Everything on it is either something that happened or
 * something explicitly labelled as not yet proven. No projections presented as
 * results, and no partner named who has not agreed to be named.
 */
export default function EvidencePage() {
  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 pt-16">
        <PageIntro
          eyebrow="Evidence"
          title="This did not start with a hypothesis"
          lede="The problem was experienced firsthand, working between a university, a workforce organization, employers, and learners. Pieces of the solution have been tested in the real world with real placements. What is not yet proven is stated as such."
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The survey                                                          */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="What 177 students said stops them"
        lede="A survey of 177 students, asking what actually prevents them from taking a career-connected opportunity. The answers were not what a job board would fix."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {[
            {
              barrier: "The cost of internship credit",
              why: "A learner is asked to pay tuition in order to receive credit for work they are doing — sometimes work that is already being subsidised from another direction. It is the barrier we can most directly remove, and the one nothing in the sector currently addresses.",
            },
            {
              barrier: "Not knowing what exists",
              why: "Opportunities that were open, local, and a good fit went unfilled because the people they were written for never saw them.",
            },
            {
              barrier: "Scheduling",
              why: "Class schedules, existing jobs, and family obligations that a full-semester commitment cannot bend around.",
            },
            {
              barrier: "Too few local options",
              why: "A short list of opportunities close to home, in a place where relocating for an internship is not realistic.",
            },
          ].map((item) => (
            <Card key={item.barrier} elevation="floating" className="p-7">
              <h3 className="text-lg font-extrabold text-ink-950 tracking-tight text-balance">
                {item.barrier}
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                {item.why}
              </p>
            </Card>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Tested in practice                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="What has already been tested"
        lede="Not a pilot we are proposing. Work that was done, inside existing organizations, before this became a venture."
      >
        <div className="space-y-4">
          {[
            {
              title: "Two systems, connected deliberately",
              copy: "Working across a regional university and a Kansas workforce organization at the same time made it possible to see the same talent problem from both sides — and to test what happens when education, employers, workforce funding, and learners are intentionally connected rather than left to find each other. That included placing learners with rural employers and coordinating workforce funding against career-connected experiences.",
            },
            {
              title: "Short-format experiences, statewide",
              copy: "Involvement in a statewide micro-internship program extended that discovery beyond one region and tested a second model: shorter, project-based ways for employers and learners to connect when a full semester is not realistic for either.",
            },
            {
              title: "Direct work with small employers",
              copy: "Ongoing conversations with employers about what makes participation realistic for an organization with no HR department, limited time, and no experience hosting a learner. This is what shaped the service around them rather than around the program.",
            },
          ].map((item) => (
            <Card key={item.title} elevation="floating" className="p-7">
              <h3 className="text-lg font-extrabold text-ink-950 tracking-tight">
                {item.title}
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed max-w-3xl text-pretty">
                {item.copy}
              </p>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-ink-600 leading-relaxed text-pretty">
          The consistent finding across all of it: rural communities usually
          already have the programs, the funding, the employers, and the talented
          people. What is missing is the connective infrastructure between them.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Committed                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="What is already committed"
        lede="Technology funding secured before launch, earmarked specifically for the partner dashboard."
      >
        <dl className="grid grid-cols-2 md:grid-cols-3 rounded-panel bg-surface border border-line shadow-e2 divide-x divide-y md:divide-y-0 divide-line overflow-hidden">
          <Figure value="$15,000" says="development funding won in a pitch competition" />
          <Figure value="$5,000" says="from a private investor, earmarked for the same build" />
          <Figure value="$20,000" says="committed to technology development in total" />
        </dl>

        <p className="mt-8 max-w-3xl text-ink-600 leading-relaxed text-pretty">
          That funds the dashboard partners use to see and manage their own
          ecosystem — employers, opportunities, pathways, funding, and outcomes
          in one place. A working prototype of the surrounding workflow already
          exists and can be clicked through today.
        </p>

        <Link
          href={DEMO_ROOT}
          className="group mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-ink-950 transition-colors"
        >
          Open the prototype
          <ArrowRight
            className="w-4 h-4 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </Link>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Not yet proven                                                      */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="What is not proven yet"
        lede="Stated here rather than left for someone to discover. A venture that publishes its own open questions is easier to trust on the answered ones."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              q: "Who pays, and what for",
              a: "The service need has been validated through direct implementation. The institutional revenue model has not. Moving from people saying they need this to organizations allocating budget for it is the next real test, and it is the one the proving ground exists to run.",
            },
            {
              q: "Whether it travels",
              a: "A model that works because one person knows every partner in one community is not yet a business. Four communities — three university towns and one much smaller — are how we find out which parts are repeatable and which were local luck.",
            },
            {
              q: "Where participants end up",
              a: "The outcome that matters is employment close to home, and it takes a year of data to produce. We are building the measurement before there is anything to measure, so year one is not retrospectively unmeasurable.",
            },
          ].map((item) => (
            <Card key={item.q} elevation="floating" className="p-7">
              <h3 className="text-lg font-extrabold text-ink-950 tracking-tight">
                {item.q}
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                {item.a}
              </p>
            </Card>
          ))}
        </div>

        <div className="mt-8 max-w-3xl rounded-panel border border-dashed border-line-strong px-6 py-5">
          <h3 className="font-extrabold text-ink-950 tracking-tight">
            Where the venture stands
          </h3>
          <p className="text-sm text-ink-600 mt-2 leading-relaxed text-pretty">
            Pre-revenue and in validation. The work that produced these findings
            was carried out through existing organizations and programs; nothing
            has yet been earned as a standalone venture. The first phase opens in
            2027 with the first paying partners.
          </p>
        </div>
      </Section>
    </div>
  );
}
