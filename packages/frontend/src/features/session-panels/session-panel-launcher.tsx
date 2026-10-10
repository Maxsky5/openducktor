import { ArrowRight } from "lucide-react";
import { type ReactElement, useId } from "react";
import { PANEL_TAB_KIND_RULES, type PanelTabKind } from "./panel-tab-kinds";
import type { PanelLauncherEntry } from "./use-session-panels";

/** Shows one card for each tab kind that a panel can open now. */
export function SessionPanelLauncher({
  entries,
  onPick,
}: {
  entries: readonly PanelLauncherEntry[];
  onPick: (kind: PanelTabKind) => void;
}): ReactElement {
  return (
    <section aria-label="Open a tab" className="h-full min-h-0 overflow-y-auto bg-card p-4">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">All tabs that this panel can show are open.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {entries.map((entry) => (
            <li key={entry.kind}>
              <SessionPanelLauncherCard entry={entry} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionPanelLauncherCard({
  entry,
  onPick,
}: {
  entry: PanelLauncherEntry;
  onPick: (kind: PanelTabKind) => void;
}): ReactElement {
  const id = useId();
  const rule = PANEL_TAB_KIND_RULES[entry.kind];
  const Icon = rule.icon;
  return (
    <button
      type="button"
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-description`}
      className="group relative flex h-full w-full cursor-pointer items-center gap-3.5 rounded-xl border border-border bg-muted/20 py-3.5 pr-10 pl-3.5 text-left transition-[background-color,border-color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none enabled:hover:border-selected-accent/40 enabled:hover:bg-muted/50 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:enabled:active:scale-100"
      disabled={entry.disabledReason !== null}
      onClick={() => onPick(entry.kind)}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border ring-inset transition-colors duration-150 group-enabled:group-hover:text-selected-accent group-enabled:group-hover:ring-selected-accent/30">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium text-foreground">
          {rule.label}
        </span>
        <span id={`${id}-description`} className="text-xs leading-relaxed text-muted-foreground">
          {entry.disabledReason ?? rule.description}
        </span>
      </span>
      <ArrowRight
        className="absolute right-3.5 size-4 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-150 ease-out group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-enabled:group-hover:translate-x-0 group-enabled:group-hover:opacity-100 motion-reduce:translate-x-0"
        aria-hidden="true"
      />
    </button>
  );
}
