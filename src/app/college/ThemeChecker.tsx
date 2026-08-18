"use client";

import { useMemo, useState } from "react";
import { Palette, CircleAlert, Info, Check } from "lucide-react";
import { Card, CardHeader, Assumption } from "@/components/ui";
import { analyzeTheme, type Severity } from "@/theme/analyze";

/**
 * Where a college sets its colours, and finds out what will happen to them.
 *
 * The theme layer guarantees a readable result whatever is entered — a hue is
 * extracted and the ramp is computed to meet every contrast target. This is
 * the half that explains it. Enforcement without explanation reads as a
 * product that ignored what you typed.
 *
 * Live rather than on submit, because the interesting findings are about the
 * *relationship* between two colours — whether they read as a pair, whether
 * one collides with a status colour — and those only make sense while you are
 * moving them.
 */
export function ThemeChecker({
  initialBrand,
  initialAccent,
  organizationName,
}: {
  initialBrand: string;
  initialAccent?: string;
  organizationName: string;
}) {
  const [brand, setBrand] = useState(initialBrand);
  const [accent, setAccent] = useState(initialAccent ?? "");

  const report = useMemo(
    () => analyzeTheme(brand, accent || undefined),
    [brand, accent],
  );

  return (
    <Card>
      <CardHeader
        level={3}
        icon={<Palette className="w-5 h-5" />}
        title="Your colours"
        subtitle={`How ${organizationName} appears to its students`}
      />

      <div className="px-6 py-5 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <ColorInput
            label="Primary"
            hint="Headings, buttons, links."
            value={brand}
            onChange={setBrand}
          />
          <ColorInput
            label="Second colour"
            hint="A band and the mark. Optional."
            value={accent}
            onChange={setAccent}
            placeholder="Not set"
          />
        </div>

        {/* What will actually render, beside what was asked for — the whole
            point is that the difference is visible rather than discovered. */}
        <div>
          <p className="text-xs font-bold text-ink-700 uppercase tracking-wider mb-2">
            What students will see
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {([50, 100, 200, 400, 500, 600, 700] as const).map((step) => (
              <div key={step} className="text-center">
                <span
                  className="block w-12 h-12 rounded-lg border border-line-strong"
                  style={{ backgroundColor: report.ramp[step] }}
                  title={`${step} — ${report.ramp[step]}`}
                />
                <span className="text-[10px] text-ink-500 tabular">{step}</span>
              </div>
            ))}
            {report.accent && (
              <div className="text-center ml-2">
                <span
                  className="w-12 h-12 rounded-lg border border-line-strong flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: report.accent.fill,
                    color: report.accent.on,
                  }}
                  title={`accent — ${report.accent.fill}`}
                >
                  Aa
                </span>
                <span className="text-[10px] text-ink-500">accent</span>
              </div>
            )}
          </div>
        </div>

        <ul className="space-y-2.5">
          {report.findings.length === 0 && (
            <Finding
              severity="ok"
              title="Nothing to flag"
              detail="These colours render as given and sit clear of the colours this product uses for status."
            />
          )}
          {report.findings.map((finding, index) => (
            <Finding key={`${finding.title}-${index}`} {...finding} />
          ))}
        </ul>

        <Assumption>
          A preview. Saving a partner&rsquo;s branding needs a write path that
          does not exist yet — the colours above come from the seeded record.
          The checks and the generated palette are real.
        </Assumption>
      </div>
    </Card>
  );
}

function ColorInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-bold text-ink-700 uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-line-strong bg-white cursor-pointer shrink-0"
        />
        <input
          type="text"
          aria-label={`${label} hex value`}
          value={value}
          placeholder={placeholder ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-line-strong px-3 py-2 text-sm tabular focus:outline-none focus:ring-2 focus:ring-brand-700"
        />
      </div>
      <p className="text-xs text-ink-500">{hint}</p>
    </div>
  );
}

const TONE: Record<Severity, { icon: typeof Info; className: string; label: string }> = {
  ok: { icon: Check, className: "text-good-700", label: "Fine" },
  adjusted: { icon: Info, className: "text-brand-700", label: "Adjusted" },
  warning: { icon: CircleAlert, className: "text-warn-700", label: "Worth knowing" },
};

function Finding({
  severity,
  title,
  detail,
  suggestion,
}: {
  severity: Severity;
  title: string;
  detail: string;
  suggestion?: string;
}) {
  const { icon: Icon, className, label } = TONE[severity];

  return (
    <li className="flex gap-3 rounded-xl border border-line-strong px-3.5 py-3">
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${className}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950">
          <span className="sr-only">{label}: </span>
          {title}
        </p>
        <p className="text-xs text-ink-600 mt-1">{detail}</p>
        {suggestion && (
          <p className="text-xs text-ink-700 mt-1.5 border-l-2 border-brand-200 pl-2.5">
            {suggestion}
          </p>
        )}
      </div>
    </li>
  );
}
