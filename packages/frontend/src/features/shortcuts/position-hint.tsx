import { SHORTCUT_POSITIONS } from "@openducktor/contracts";
import { CommandPaletteContext } from "../command-palette/command-palette-context";
import { commandDefinition } from "./catalogue";
import { shortcutLabel } from "@openducktor/frontend-core/shortcuts/key-labels";
import { use } from "react";
import { SessionPositionsContext } from "./session-positions-context";
import { useShortcutLabel } from "./use-shortcut-label";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
export function SessionPositionHint({
  entryKey,
  className,
}: {
  entryKey: string;
  className?: string | undefined;
}) {
  const position = use(SessionPositionsContext).get(entryKey);
  return position ? (
    <PositionHint family="session" position={position} className={className} />
  ) : null;
}
export function PositionHint({
  family,
  position,
  className,
}: {
  family: "session" | "workspace";
  position: number;
  className?: string | undefined;
}) {
  const number = SHORTCUT_POSITIONS.find((value) => value === position);
  const id = number ? (`${family}-position-${number}` as const) : undefined;
  const label = useShortcutLabel(id);
  const platform = use(CommandPaletteContext)?.platform;
  const defaultKeys = id ? commandDefinition(id)?.defaultKeys.browser : null;
  const defaultLabel = platform && defaultKeys ? shortcutLabel(defaultKeys, platform) : null;
  let hint = label ?? "—";
  if (label === defaultLabel) {
    const digit = String(position % 10);
    const shift = platform === "darwin" ? "⇧" : "Shift";
    hint = family === "workspace" ? `${shift} ${digit}` : digit;
  }
  return (
    <Kbd
      aria-hidden="true"
      title={position <= 10 ? (label ?? "Unassigned") : undefined}
      className={cn(
        "shortcut-position-hint pointer-events-auto col-start-1 row-start-1 h-4 min-w-4 max-w-24 text-foreground",
        className,
      )}
    >
      <span className="truncate">{position > 10 ? position : hint}</span>
    </Kbd>
  );
}
