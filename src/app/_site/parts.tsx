/**
 * The pieces the venture pages share.
 *
 * Private (`_site` is not a route segment). Written once because five pages
 * that each invent their own heading block is how a small site starts looking
 * like five sites — and because the demo's `PageHeader` is the wrong
 * instrument here: it is built for a portal with a signed-in actor and a
 * status line, neither of which exists on a public page.
 */

import type { ReactNode } from "react";

/** The top of an interior page. */
export function PageIntro({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="max-w-3xl">
      <span className="inline-flex items-center gap-2 text-[0.7rem] font-bold text-brand-700 uppercase tracking-[0.14em]">
        <span aria-hidden="true" className="h-px w-6 bg-brand-200" />
        {eyebrow}
      </span>
      <h1 className="text-[2.1rem] md:text-[3rem] font-black text-ink-950 tracking-[-0.028em] leading-[1.06] text-balance mt-4">
        {title}
      </h1>
      <p className="mt-5 text-lg text-ink-600 leading-relaxed text-pretty">{lede}</p>
    </header>
  );
}

/** A named zone within a page. */
export function Section({
  title,
  lede,
  children,
  tone = "plain",
}: {
  title: string;
  lede?: string;
  children: ReactNode;
  /** `sunk` bands a section onto the surface colour so a boundary registers. */
  tone?: "plain" | "sunk";
}) {
  const body = (
    <div className="max-w-6xl mx-auto px-6">
      <div className="max-w-3xl">
        <h2 className="text-2xl md:text-3xl font-black text-ink-950 tracking-[-0.02em] text-balance">
          {title}
        </h2>
        {lede && (
          <p className="mt-3 text-ink-600 leading-relaxed text-pretty">{lede}</p>
        )}
      </div>
      <div className="mt-9">{children}</div>
    </div>
  );

  return tone === "sunk" ? (
    <section className="bg-surface border-y border-line py-20">{body}</section>
  ) : (
    <section className="py-20">{body}</section>
  );
}

/**
 * A figure and what it counts.
 *
 * Deliberately requires the sentence, not just a label. Every number on these
 * pages is one somebody may ask about in a meeting, and a bare "177" under the
 * word "students" invites the wrong reading of it.
 */
export function Figure({ value, says }: { value: string; says: string }) {
  return (
    // A `dd`/`dt` pair inside a wrapping `div`, because the caller is a `dl`
    // and a run of plain `div`s inside one is a real accessibility failure
    // rather than a lint preference — a screen reader gets a list with no
    // terms in it. The value leads visually and the term follows, which is
    // the readable order for a figure and the permitted one for the markup.
    <div className="px-5 py-6">
      <dd className="text-4xl font-black text-ink-950 tabular leading-none">
        {value}
      </dd>
      <dt className="text-sm text-ink-600 mt-3 leading-snug text-pretty">{says}</dt>
    </div>
  );
}
