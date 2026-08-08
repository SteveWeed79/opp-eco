"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/**
 * Tabbed sections.
 *
 * Follows the ARIA tabs pattern: arrow keys move between tabs, Home and End
 * jump to the ends, and only the active tab is in the tab order — so a
 * keyboard user tabs *past* the tablist rather than through every tab in it.
 *
 * A count on a tab is the point of using tabs at all here: the college has
 * four queues and needs to see which ones have work waiting without opening
 * each one.
 */

export interface TabDefinition {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

export function Tabs({
  tabs,
  initial,
  label,
}: {
  tabs: TabDefinition[];
  initial?: string;
  /** Names the tablist for assistive technology. */
  label: string;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: React.KeyboardEvent) {
    const index = tabs.findIndex((t) => t.id === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;

    event.preventDefault();
    const id = tabs[next].id;
    setActive(id);
    refs.current[id]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-ink-200 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                selected
                  ? "border-brand-500 text-ink-950"
                  : "border-transparent text-ink-500 hover:text-ink-950"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`ml-2 px-1.5 py-0.5 rounded-md text-xs tabular ${
                    tab.count > 0
                      ? "bg-warn-100 text-warn-700"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className="pt-5 focus:outline-none"
        >
          {tab.id === active && tab.content}
        </div>
      ))}
    </div>
  );
}
