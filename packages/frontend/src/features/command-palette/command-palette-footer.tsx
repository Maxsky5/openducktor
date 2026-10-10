import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { KeyCaps } from "./command-palette-key-caps";

/** One footer hint. Its key caps and its click run the same handler. */
export type CommandPaletteHint = {
  id: string;
  keys: readonly string[];
  label: string;
  run: () => void;
};

const NO_HINTS: readonly CommandPaletteHint[] = [];

export function CommandPaletteFooter({
  enter = null,
  itemHints = NO_HINTS,
  note = null,
  paletteHints,
}: {
  /** What Enter does on the highlighted row, or null when it does nothing. */
  enter?: CommandPaletteHint | null;
  /** Other hints of the highlighted row. */
  itemHints?: readonly CommandPaletteHint[];
  /** Why the highlighted row cannot open yet, or null. */
  note?: string | null;
  /** Hints that apply to the whole palette. */
  paletteHints: readonly CommandPaletteHint[];
}): ReactElement {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {note ? (
          <span className="truncate px-1.5 text-xs text-muted-foreground">{note}</span>
        ) : null}
        {enter ? <HintButton hint={enter} primary /> : null}
        {itemHints.map((hint) => (
          <HintButton key={hint.id} hint={hint} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {paletteHints.map((hint) => (
          <HintButton key={hint.id} hint={hint} />
        ))}
      </div>
    </div>
  );
}

function HintButton({
  hint,
  primary = false,
}: {
  hint: CommandPaletteHint;
  primary?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      // The palette uses Tab, so hints stay out of the tab order. A click keeps input focus.
      tabIndex={-1}
      className={cn(
        "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
        primary && "font-medium text-foreground",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={hint.run}
    >
      <KeyCaps keys={hint.keys} />
      <span>{hint.label}</span>
    </button>
  );
}
