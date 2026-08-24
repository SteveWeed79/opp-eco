import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, GraduationCap, Landmark, Mail } from "lucide-react";
import { Card } from "@/components/ui";
import { PageIntro, Section } from "@/app/_site/parts";
import { brand, publicAddress, siteTitle } from "@/brand";
import { DEMO_ROOT } from "@/routes";

export const metadata: Metadata = {
  title: siteTitle("Contact"),
  description:
    "How to reach us — for communities and institutions exploring a partnership, employers who want to host, and anyone who wants to see the work.",
};

/**
 * A way to reply.
 *
 * The venture had no company address anywhere on the web: a funder or a
 * partner who read about it and wanted to respond had a personal inbox and
 * nothing else, which is the difference between an organization and a project.
 * The address is built from `brand.ts` so pointing it somewhere else is one
 * edit — see the note on `contactMailbox` there.
 */
export default function ContactPage() {
  const email = publicAddress(brand.contactMailbox);

  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 pt-16">
        <PageIntro
          eyebrow="Contact"
          title="Tell us what your community is trying to connect"
          lede="Whether you are exploring a partnership, want to host a learner, or are simply curious whether this applies where you are — the first conversation costs nothing and usually tells us both quite a lot."
        />
      </div>

      <Section title="Reach us">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr] items-start">
          <Card elevation="floating" className="p-7">
            <span className="w-11 h-11 bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 rounded-card flex items-center justify-center ring-1 ring-brand-200/70 shadow-e1">
              <Mail className="w-5 h-5" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-extrabold text-ink-950 tracking-tight mt-5">
              Email
            </h2>
            <p className="mt-2">
              <a
                href={`mailto:${email}`}
                className="text-brand-700 font-bold underline underline-offset-4 decoration-brand-200 hover:decoration-brand-700 transition-colors break-all"
              >
                {email}
              </a>
            </p>
            <dl className="mt-6 pt-5 border-t border-line space-y-3 text-sm">
              <div>
                <dt className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em]">
                  Founder
                </dt>
                <dd className="text-ink-700 font-semibold mt-0.5">
                  {brand.founderName}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em]">
                  Based in
                </dt>
                <dd className="text-ink-700 font-semibold mt-0.5">
                  {brand.headquarters}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] font-bold text-ink-500 uppercase tracking-[0.12em]">
                  Working across
                </dt>
                <dd className="text-ink-700 font-semibold mt-0.5">
                  Rural Kansas
                </dd>
              </div>
            </dl>
          </Card>

          <div className="space-y-4">
            <p className="text-ink-600 leading-relaxed text-pretty">
              It helps to know which of these you are, but none of it is
              required — a sentence about what is not connecting where you are
              is enough to start.
            </p>

            {[
              {
                icon: Landmark,
                who: "A community or institution",
                copy: "Colleges, workforce and economic development organizations, chambers, and community partners. Start with the assessment conversation — what already exists where you are, and where it is not connecting.",
                href: "/partners",
                cta: "What a partnership includes",
              },
              {
                icon: Building2,
                who: "An employer",
                copy: "If you have work worth doing and no idea how to scope it into something a learner could take on, that is the normal starting position and it is the part we do.",
                href: "/approach",
                cta: "How an opportunity gets built",
              },
              {
                icon: GraduationCap,
                who: "A learner, or someone who works with them",
                copy: "Opportunities run through local education and workforce partners in each community. Tell us where you are and we will point you at whoever is closest.",
                href: "/evidence",
                cta: "What we have learned so far",
              },
            ].map((row) => {
              const Icon = row.icon;
              return (
                <Card key={row.who} className="p-6">
                  <div className="flex gap-4">
                    <span className="shrink-0 w-10 h-10 bg-canvas-deep text-ink-600 rounded-card flex items-center justify-center border border-line">
                      <Icon className="w-4.5 h-4.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-ink-950 tracking-tight">
                        {row.who}
                      </h3>
                      <p className="text-sm text-ink-600 mt-1.5 leading-relaxed text-pretty">
                        {row.copy}
                      </p>
                      <Link
                        href={row.href}
                        className="group mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-ink-950 transition-colors"
                      >
                        {row.cta}
                        <ArrowRight
                          className="w-4 h-4 transition-transform group-hover:translate-x-1"
                          aria-hidden="true"
                        />
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </Section>

      <Section
        tone="sunk"
        title="Before you write, you can look"
        lede="The working prototype shows what the coordination looks like from all five sides — learner, employer, college, workforce board, and the administrator watching where placements stall. It runs on invented organizations and says so on every screen."
      >
        <Link
          href={DEMO_ROOT}
          className="group inline-flex items-center gap-2.5 bg-gradient-to-b from-brand-600 to-brand-700 text-white font-bold px-7 py-3.5 rounded-panel shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_4px_16px_-4px_rgb(3_105_161/0.55)] hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          Open the prototype
          <ArrowRight
            className="w-5 h-5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      </Section>
    </div>
  );
}
