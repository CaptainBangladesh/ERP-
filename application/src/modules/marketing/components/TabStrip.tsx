import { useRef } from 'react';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly group: string;
  /** Reachable by URL but not shown in the strip — see the `records` scaffold. */
  readonly hidden?: boolean;
  /** Rendered as a count chip, with the label supplying what it counts. */
  readonly count?: number;
}

/**
 * The marketing workspace's destinations, as one control.
 *
 * There were nine of these — nine copies of the same twelve-line button, pasted, which is how
 * the strip came to be ~1,500px of tabs with no wrapping and how a screen reader came to
 * announce nine unrelated buttons with no indication that they are one group, which is current,
 * or what each one controls. Both problems are structural, so the fix is structural: one array
 * of destinations, one component that renders it, and the W3C APG Tabs keyboard set written
 * once here rather than per tab.
 *
 * Adding a destination is a new entry in that array. It is never a new pasted block.
 */
export function TabStrip({
  tabs,
  activeId,
  onSelect,
  label,
  panelId,
}: {
  tabs: readonly TabDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  label: string;
  /** The `id` of the `tabpanel` every tab controls. */
  panelId: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const visible = tabs.filter((tab) => !tab.hidden);

  /**
   * Left/Right with wrap, Home/End.
   *
   * Focus is moved *and* the tab is selected, which is the APG's automatic-activation variant.
   * It is the right one here: every panel is already mounted behind a query this screen holds,
   * so following the arrow costs nothing and a keyboard user is not made to press Enter on
   * every stop to see where they are.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // From the *focused* tab, not the selected one. They are normally the same under automatic
    // activation, but not while focus is being moved programmatically — and taking the selected
    // one there makes an arrow key move relative to somewhere the user is not.
    const focusedId = (document.activeElement as HTMLElement | null)?.id ?? '';
    const focused = visible.findIndex((tab) => tabButtonId(tab.id) === focusedId);
    const index = focused === -1 ? visible.findIndex((tab) => tab.id === activeId) : focused;
    if (index === -1) return;

    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % visible.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + visible.length) % visible.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    if (next === undefined) return;

    event.preventDefault();
    const target = visible[next];
    if (!target) return;
    onSelect(target.id);
    stripRef.current?.querySelector<HTMLElement>(`#${tabButtonId(target.id)}`)?.focus();
  }

  /**
   * `flex-wrap`, `overflow-x-auto` and `shrink-0`, unconditionally.
   *
   * Not because eight tabs need it — they do not — but because this repository has shipped the
   * crushed-and-then-page-widening tab strip once already, in the CRM workspace, and the guard
   * costs three class names. It stays whatever the strip is later cut down to.
   */
  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-end gap-x-1 gap-y-2 overflow-x-auto border-b border-slate-200 text-sm font-medium text-slate-600"
    >
      {groupsOf(visible).map(([group, groupTabs]) => (
        <div key={group} role="presentation" className="flex shrink-0 items-end">
          <span
            aria-hidden="true"
            className="mr-1.5 self-center px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"
          >
            {group}
          </span>

          {groupTabs.map((tab) => {
            const selected = tab.id === activeId;
            return (
              <button
                key={tab.id}
                id={tabButtonId(tab.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                // Roving tabindex: one stop for the whole strip, then arrows inside it.
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(tab.id)}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 ${
                  selected
                    ? 'border-slate-900 font-semibold text-slate-900'
                    : 'border-transparent hover:border-slate-300 hover:text-slate-800'
                }`}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  // The number alone announces as "3". The visually-hidden half says what of.
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    <span aria-hidden="true">{tab.count}</span>
                    <span className="sr-only">
                      {tab.count} {tab.label}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function tabButtonId(id: string): string {
  return `marketing-tab-${id}`;
}

/** Groups in the order the array declares them, so ordering stays a property of `TABS`. */
function groupsOf(tabs: readonly TabDefinition[]): Array<[string, TabDefinition[]]> {
  const groups: Array<[string, TabDefinition[]]> = [];
  for (const tab of tabs) {
    const existing = groups.find(([name]) => name === tab.group);
    if (existing) existing[1].push(tab);
    else groups.push([tab.group, [tab]]);
  }
  return groups;
}
