"use client";

import { useMemo, useRef, useState, useId } from "react";
import { Check, ChevronDown, X } from "lucide-react";

/**
 * Filterable multi-select.
 *
 * Built for skill selection. A native `select` collapses past a few dozen
 * options, and skills come from a taxonomy with hundreds — O*NET alone would
 * make a plain list unusable.
 *
 * Selected values render as removable chips so the current selection is
 * readable without opening the list, which is the failure mode of a
 * multi-select that only shows a count.
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = "Search…",
  hint,
  max,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  /** Cap the selection, e.g. "pick your top eight skills". */
  max?: number;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !value.includes(o))
      .filter((o) => (q ? o.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [options, value, query]);

  const atLimit = max !== undefined && value.length >= max;

  function select(option: string) {
    if (atLimit) return;
    onChange([...value, option]);
    setQuery("");
    setHighlighted(0);
    inputRef.current?.focus();
  }

  function remove(option: string) {
    onChange(value.filter((v) => v !== option));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter" && open && matches[highlighted]) {
      event.preventDefault();
      select(matches[highlighted]);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && query === "" && value.length > 0) {
      // Backspace on an empty field removes the last chip, as in every other
      // token input people have used.
      remove(value[value.length - 1]);
    }
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-bold text-ink-700 uppercase tracking-wider"
      >
        {label}
        {max !== undefined && (
          <span className="ml-2 font-normal normal-case tracking-normal text-ink-500">
            {value.length} of {max}
          </span>
        )}
      </label>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}

      <div className="rounded-xl border border-line-strong bg-white focus-within:ring-2 focus-within:ring-brand-500 px-2 py-2">
        {value.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mb-2">
            {value.map((selected) => (
              <li key={selected}>
                <span className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 border border-brand-200 rounded-lg pl-2.5 pr-1.5 py-1 text-xs font-semibold">
                  {selected}
                  <button
                    type="button"
                    onClick={() => remove(selected)}
                    aria-label={`Remove ${selected}`}
                    className="hover:text-ink-950"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="relative">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              id={id}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-listbox`}
              aria-autocomplete="list"
              value={query}
              disabled={atLimit}
              placeholder={atLimit ? `Limit of ${max} reached` : placeholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onKeyDown={onKeyDown}
              className="flex-1 px-2 py-1 text-sm outline-none disabled:bg-transparent disabled:text-ink-400"
            />
            <ChevronDown className="w-4 h-4 text-ink-400" aria-hidden="true" />
          </div>

          {open && matches.length > 0 && (
            <ul
              id={`${id}-listbox`}
              role="listbox"
              className="absolute z-20 left-0 right-0 mt-2 bg-white border border-line-strong rounded-card shadow-e4 overflow-hidden"
            >
              {matches.map((option, index) => (
                <li
                  key={option}
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(option);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${
                    index === highlighted ? "bg-brand-50 text-brand-700" : "text-ink-700"
                  }`}
                >
                  {option}
                  {index === highlighted && (
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
