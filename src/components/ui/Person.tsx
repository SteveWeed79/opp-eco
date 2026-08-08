import type { ReactNode } from "react";

/**
 * People, rendered consistently.
 *
 * Students, counsellors, board officers, and supervisors appear on every
 * screen, and were being formatted four different ways. Colour is derived from
 * the name so the same person is the same colour everywhere — a weak but free
 * recognition aid — and never carries meaning on its own, since it is not
 * available to everyone.
 */

const PALETTE = [
  "bg-brand-100 text-brand-700",
  "bg-good-100 text-good-700",
  "bg-warn-100 text-warn-700",
  "bg-micro-100 text-micro-700",
  "bg-ink-200 text-ink-700",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  // Strip honorifics so "Dr. Ellen Vance" reads EV rather than DE.
  const meaningful = parts.filter((p) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(p));
  const used = meaningful.length > 0 ? meaningful : parts;
  if (used.length === 1) return used[0].slice(0, 2).toUpperCase();
  return (used[0][0] + used[used.length - 1][0]).toUpperCase();
}

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "w-7 h-7 text-[11px]",
    md: "w-9 h-9 text-xs",
    lg: "w-12 h-12 text-sm",
  };
  return (
    <span
      // The name is announced by the adjacent text, so the initials are
      // decorative here rather than a second reading of the same person.
      aria-hidden="true"
      className={`${sizes[size]} ${toneFor(name)} rounded-full flex items-center justify-center font-bold shrink-0`}
    >
      {initials(name)}
    </span>
  );
}

export function PersonChip({
  name,
  subtitle,
  size = "md",
  trailing,
}: {
  name: string;
  subtitle?: ReactNode;
  size?: "sm" | "md" | "lg";
  trailing?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        <span className="block font-semibold text-sm text-ink-950 truncate">{name}</span>
        {subtitle && (
          <span className="block text-xs text-ink-500 truncate">{subtitle}</span>
        )}
      </span>
      {trailing}
    </span>
  );
}
