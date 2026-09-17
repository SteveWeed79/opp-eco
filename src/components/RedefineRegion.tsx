"use client";

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  SelectField,
  TextField,
  useToast,
} from "@/components/ui";

/**
 * Record that a market's boundary moved.
 *
 * The rarest control in this product and the one with the longest reach: every
 * retention figure computed after the effective date is measured against what
 * is typed here. It is also the only form that cannot undo itself — a
 * definition is appended, never edited, so a mistake is corrected by a third
 * definition rather than by fixing the second.
 *
 * So it shows the boundary in force and the whole history above the fields.
 * Somebody about to change a map should be able to see the map.
 */

export interface RegionChoice {
  marketId: string;
  marketName: string;
  /** Newest first. The current boundary is the first entry. */
  history: {
    id: string;
    counties: string[];
    state: string;
    effectiveFrom: string;
    source?: string;
  }[];
}

export function RedefineRegion({
  markets,
  action,
}: {
  markets: RegionChoice[];
  action: (
    marketId: unknown,
    state: unknown,
    counties: unknown,
    effectiveFrom: unknown,
    source: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [marketId, setMarketId] = useState(markets[0]?.marketId ?? "");
  const [counties, setCounties] = useState("");
  const [state, setState] = useState("KS");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [source, setSource] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const chosen = markets.find((m) => m.marketId === marketId);
  const current = chosen?.history[0];
  const ready = marketId && counties.trim() && state.trim() && effectiveFrom && source.trim();

  function submit() {
    if (!ready) return;
    startTransition(async () => {
      const result = await action(
        marketId,
        state,
        counties,
        new Date(`${effectiveFrom}T00:00:00Z`).toISOString(),
        source,
      );
      if (result.ok) {
        toast.show("success", "Recorded. Figures before that date are unchanged.");
        setCounties("");
        setEffectiveFrom("");
        setSource("");
      } else {
        toast.show("error", result.error ?? "Could not record that.");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        level={3}
        icon={<MapPin className="w-5 h-5" />}
        title="Redefine a region"
        subtitle="When a workforce area is redesignated or a census redraws a boundary"
      />
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          This <span className="font-semibold">adds</span> a boundary rather than
          changing one. Every figure already computed keeps the map it was
          measured against, and the new one applies from the date you give —
          which is why a mistake here is fixed by recording another change, not
          by editing this one.
        </p>

        <SelectField
          label="Market"
          value={marketId}
          onChange={(event) => setMarketId(event.target.value)}
          options={markets.map((m) => ({ value: m.marketId, label: m.marketName }))}
        />

        {chosen && (
          <div className="rounded-card border border-line bg-paper-50 px-4 py-3">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-widest mb-2">
              {chosen.history.length === 1 ? "Boundary on record" : "Boundaries on record"}
            </p>
            <ul className="space-y-1.5">
              {chosen.history.map((definition, index) => (
                <li key={definition.id} className="text-xs text-ink-700">
                  <span className="font-semibold">
                    {definition.counties.join(" · ")} · {definition.state}
                  </span>
                  <span className="text-ink-500">
                    {" — from "}
                    {new Date(definition.effectiveFrom).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                    {index === 0 ? " · in force" : ""}
                    {definition.source ? ` · ${definition.source}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <TextField
          label="Counties"
          value={counties}
          onChange={(event) => setCounties(event.target.value)}
          hint={
            current
              ? `Comma separated, and the whole list — not just what changed. Currently ${current.counties.join(", ")}.`
              : "Comma separated, and the whole list."
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          <TextField
            label="State"
            value={state}
            maxLength={2}
            onChange={(event) => setState(event.target.value.toUpperCase())}
            hint="Two letters."
          />
          <TextField
            label="In force from"
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            hint="Must be after the boundary it replaces."
          />
        </div>
        <TextField
          label="What changed this"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          hint="The redesignation notice, the census, the board's paperwork. Recorded permanently against the boundary."
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />

        <Button variant="primary" onClick={submit} disabled={pending || !ready}>
          {pending ? "Recording…" : "Record the new boundary"}
        </Button>
      </div>
    </Card>
  );
}
