"use client";

import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Form controls.
 *
 * Every control is wired to its label by a generated id rather than relying on
 * placeholder text, and errors are announced. A placeholder is not a label —
 * it disappears exactly when the user needs it and is invisible to some
 * assistive technology.
 */

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
}

function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-bold text-ink-700 uppercase tracking-wider"
      >
        {label}
        {required && (
          <span className="text-crit-600 ml-1" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {children({ id, describedBy })}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-crit-700">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "w-full px-4 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-950 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-transparent " +
  "disabled:bg-ink-50 disabled:text-ink-400";

export function TextField({
  label,
  hint,
  error,
  required,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <input
          {...props}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${CONTROL} ${error ? "border-crit-600" : ""}`}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <textarea
          {...props}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${CONTROL} min-h-24 resize-y ${error ? "border-crit-600" : ""}`}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  options,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <select
          {...props}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${CONTROL} ${error ? "border-crit-600" : ""}`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/**
 * A set of mutually exclusive choices rendered as cards.
 *
 * Used where the choice carries enough context that a native select would hide
 * it — picking a demo account, picking an interview slot, picking a posting
 * track.
 *
 * A **radiogroup**, not a row of toggle buttons. It rendered as buttons with
 * `aria-pressed` for a while, which is valid ARIA and the wrong meaning: a
 * toggle button announces "pressed"/"not pressed" and implies each option is
 * independently on or off. A screen reader user got no indication that picking
 * one released the others, and no "2 of 3" position. Radios say exactly that.
 *
 * Keyboard behaviour follows the radiogroup pattern rather than the button
 * one: the group holds a single tab stop and arrow keys move *and* select
 * within it, so tabbing past a set of options takes one keystroke instead of
 * one per option.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 1,
}: {
  label: string;
  value: T | null;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string; meta?: string }[];
  columns?: 1 | 2;
}) {
  const selectedIndex = options.findIndex((o) => o.value === value);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const from = selectedIndex === -1 ? 0 : selectedIndex;
    const next =
      (from + (forward ? 1 : -1) + options.length) % options.length;

    onChange(options[next].value);
    // Move focus with the selection, as the pattern requires — otherwise the
    // focus ring stays behind and the next arrow press moves from the wrong
    // place.
    event.currentTarget
      .querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
  }

  return (
    <fieldset>
      <legend className="block text-xs font-bold text-ink-700 uppercase tracking-wider mb-2">
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={`grid gap-2 ${columns === 2 ? "sm:grid-cols-2" : ""}`}
      >
        {options.map((option, index) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              // One tab stop for the whole group. When nothing is selected the
              // first option takes it, so the group is always reachable.
              tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={`text-left p-3.5 rounded-xl border transition-colors ${
                selected
                  ? "border-brand-700 bg-brand-50"
                  : "border-ink-200 hover:bg-ink-50"
              }`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-sm text-ink-950">{option.label}</span>
                {option.meta && (
                  <span className="text-xs text-ink-500">{option.meta}</span>
                )}
              </span>
              {option.description && (
                <span className="block text-xs text-ink-500 mt-1">
                  {option.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
