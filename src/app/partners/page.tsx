import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Card } from "@/components/ui";
import { PageIntro, Section } from "@/app/_site/parts";
import { siteTitle } from "@/brand";

export const metadata: Metadata = {
  title: siteTitle("For partners"),
  description:
    "How a college, workforce or economic development organization, or community works with us to build and coordinate a career-connected learning ecosystem.",
};

/**
 * The buyer's page.
 *
 * The site previously addressed learners and employers and nobody else, which
 * left the people who actually pay for this — colleges, workforce and
 * economic development organizations, communities — with no page written for
 * them. Learners and employers are who the work is *for*; a partner is who
 * commissions it.
 *
 * **No prices here, deliberately.** Tiers are described by what they include
 * and who they suit. Willingness to pay is the single least-validated
 * assumption in this business, and a figure published before one partner has
 * paid it sets an anchor that is hard to move in either direction. The
 * conversation is where the number belongs until the proving ground has
 * produced one.
 */
export default function PartnersPage() {
  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 pt-16">
        <PageIntro
          eyebrow="For partners"
          title="You are already funding this work. It is not connecting."
          lede="Colleges, workforce and economic development organizations, and communities are investing in education, training, employer engagement, and talent retention — often in the same county, toward the same outcome, through separate systems. We are the coordination layer between them."
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* What a partner is buying                                            */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="What a partnership includes"
        lede="Not software you are left to operate. A service, delivered by people, with technology underneath it."
      >
        <div className="grid gap-px bg-line border border-line rounded-panel overflow-hidden sm:grid-cols-2">
          {[
            [
              "Ecosystem assessment",
              "What already exists in your community, who is doing part of this work, where the gaps actually are, and what is being left unused.",
            ],
            [
              "Employer outreach and opportunity development",
              "Reaching employers who would host, and doing the work of turning a stated talent need into an opportunity a learner can take on.",
            ],
            [
              "Partner coordination",
              "Getting education, workforce, employer, and community organizations working from the same picture instead of alongside one another.",
            ],
            [
              "Funding coordination",
              "Identifying what pays for a placement — workforce dollars, scholarships, philanthropic support — and connecting it to the learner and employer who need it.",
            ],
            [
              "Pathway development",
              "Building the routes from career exposure through education and training into work-based learning and employment, rather than one-off placements.",
            ],
            [
              "Outcome measurement and reporting",
              "Participation, employer engagement, resources deployed, and where people end up — reported in the terms your board or funder asks about.",
            ],
          ].map(([title, copy]) => (
            <div key={title} className="bg-surface p-7">
              <h3 className="font-extrabold text-ink-950 tracking-tight text-balance">
                {title}
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                {copy}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Tiers                                                               */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="Three levels of partnership"
        lede="Which one fits depends on how much of the network you are trying to move at once, not on the size of your organization."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {[
            {
              name: "Starter",
              suits: "One institution or one community testing whether this works here",
              includes: [
                "Ecosystem assessment",
                "Partner coordination",
                "Employer and opportunity development",
                "Basic implementation support",
              ],
            },
            {
              name: "Regional",
              suits: "A region with several partners already active and no coordination between them",
              includes: [
                "Everything in Starter",
                "Ongoing employer engagement",
                "Pathway development",
                "Outcome reporting",
              ],
              featured: true,
            },
            {
              name: "Network",
              suits: "A multi-county network spanning education, workforce, employers, and community organizations",
              includes: [
                "Everything in Regional",
                "Customised strategy",
                "Multi-partner implementation support",
                "Expanded data and reporting",
              ],
            },
          ].map((tier) => (
            <Card
              key={tier.name}
              elevation="floating"
              className={`relative overflow-hidden p-7 flex flex-col ${
                tier.featured ? "ring-1 ring-brand-200" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-1 ${
                  tier.featured
                    ? "bg-gradient-to-r from-brand-500 to-brand-700"
                    : "bg-line-strong"
                }`}
              />
              <h3 className="text-2xl font-black text-ink-950 tracking-tight">
                {tier.name}
              </h3>
              <p className="text-sm text-ink-600 mt-2.5 leading-relaxed text-pretty">
                {tier.suits}
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-ink-600 border-t border-line pt-5 flex-1">
                {tier.includes.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <Check
                      className="w-4 h-4 mt-0.5 shrink-0 text-brand-600"
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        {/* Said plainly rather than left as an omission a reader has to
            notice. "Contact us for pricing" with no explanation reads as
            something being hidden; the actual reason is more reassuring than
            the silence. */}
        <div className="mt-8 max-w-3xl rounded-panel border border-dashed border-line-strong px-6 py-5">
          <h3 className="font-extrabold text-ink-950 tracking-tight">
            Why there are no prices on this page
          </h3>
          <p className="text-sm text-ink-600 mt-2 leading-relaxed text-pretty">
            An annual partnership is scoped to the community it serves, and we
            are early enough that publishing a figure would mean guessing at one
            before a single partner has paid it. We would rather tell you what a
            year looks like for your community and price that honestly. Ask, and
            you will get a number in the first conversation.
          </p>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Year one                                                            */}
      {/* ------------------------------------------------------------------ */}
      <Section
        title="What the first year looks like"
        lede="A partnership is a year of work, not a licence. This is the shape of it."
      >
        <ol className="relative border-l border-line ml-3 space-y-8">
          {[
            {
              when: "Month 1",
              what: "Assessment",
              detail:
                "What already exists here, who is doing part of this work, which employers have talent needs they have not turned into opportunities, and what funding is going unused.",
            },
            {
              when: "Months 2–4",
              what: "Employer and opportunity development",
              detail:
                "Direct outreach to employers, scoping real work into experiences a learner can take on, and connecting the funding that makes hosting affordable for a small business.",
            },
            {
              when: "Months 5–6",
              what: "First placements",
              detail:
                "Learners matched and placed, with the coordination between education, employer, funding, and support handled rather than left to whoever notices it first.",
            },
            {
              when: "Months 7–11",
              what: "Ongoing support and pathway building",
              detail:
                "Staying with live placements — which is where they fall apart — while building the routes that make the next cycle easier than the first.",
            },
            {
              when: "Month 12",
              what: "Outcome report",
              detail:
                "Participation, employers engaged, opportunities created, resources and outside funding brought in, and where participants went next.",
            },
          ].map((step) => (
            <li key={step.when} className="relative pl-8">
              <span
                aria-hidden="true"
                className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-4 ring-canvas"
              />
              <p className="text-[0.7rem] font-bold text-brand-700 uppercase tracking-[0.12em]">
                {step.when}
              </p>
              <h3 className="text-lg font-extrabold text-ink-950 tracking-tight mt-1">
                {step.what}
              </h3>
              <p className="text-sm text-ink-600 mt-1.5 leading-relaxed max-w-2xl text-pretty">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* What stays local                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section
        tone="sunk"
        title="What we standardise, and what stays yours"
        lede="A model that only works because one person knows everybody is not a model. A model that overwrites local relationships is not welcome. Both failures are avoidable, and the line between them is the thing we are actually building."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Card elevation="floating" className="p-7">
            <span className="text-[0.7rem] font-bold text-brand-700 uppercase tracking-[0.12em]">
              Standardised
            </span>
            <h3 className="text-xl font-black text-ink-950 tracking-tight mt-1.5">
              So you are not rebuilding it
            </h3>
            <ul className="mt-5 space-y-2.5 text-sm text-ink-600 border-t border-line pt-5">
              {[
                "Employer intake and opportunity development",
                "Participant onboarding",
                "Funding coordination",
                "Data collection and outcome measurement",
                "The technology underneath all of it",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </Card>

          <Card elevation="floating" className="p-7">
            <span className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em]">
              Locally owned
            </span>
            <h3 className="text-xl font-black text-ink-950 tracking-tight mt-1.5">
              Because it cannot be anything else
            </h3>
            <ul className="mt-5 space-y-2.5 text-sm text-ink-600 border-t border-line pt-5">
              {[
                "The relationships with employers and institutions",
                "Which needs your community treats as urgent",
                "Who the trusted local operator is",
                "How this fits alongside work already underway",
                "The decisions about your own learners",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-400"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* CTA                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 pb-8">
        <div className="rounded-hero border border-line bg-surface px-8 py-12 md:px-12 shadow-e3 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div className="max-w-xl">
            <h2 className="text-2xl md:text-3xl font-black text-ink-950 tracking-[-0.02em] text-balance">
              Start with the assessment conversation
            </h2>
            <p className="mt-3 text-ink-600 leading-relaxed text-pretty">
              It costs nothing to find out what your community already has and
              where it is not connecting. That conversation is also how we scope
              a partnership and price it.
            </p>
          </div>
          <Link
            href="/contact"
            className="group shrink-0 inline-flex items-center gap-2.5 bg-gradient-to-b from-brand-600 to-brand-700 text-white font-bold px-7 py-3.5 rounded-panel shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_4px_16px_-4px_rgb(3_105_161/0.55)] hover:-translate-y-0.5 active:translate-y-0 transition-all"
          >
            Get in touch
            <ArrowRight
              className="w-5 h-5 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </section>
    </div>
  );
}
