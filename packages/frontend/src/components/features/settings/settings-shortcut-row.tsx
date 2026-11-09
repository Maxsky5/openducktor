import { useRef } from "react";
import { X } from "lucide-react";
import type { AppPlatform, ShortcutCombination } from "@openducktor/contracts";
import { shortcutLabel } from "@openducktor/frontend-core/shortcuts/key-matching";
import type { ShortcutCommandDefinition } from "@/features/shortcuts/catalogue";
import { KeyCaps } from "@/features/command-palette/command-palette-key-caps";
import { Button } from "@/components/ui/button";

const CONTEXT_LABELS = {
  app: "Application",
  workspace: "Current workspace",
  task: "Selected task",
  chat: "Selected session",
  session: "Active session",
  panel: "Focused panel",
  item: "Focused control",
  overlay: "Open dialog",
};

function ShortcutKeys({
  combination,
  platform,
}: {
  combination: ShortcutCombination | null;
  platform: AppPlatform;
}) {
  return combination ? (
    <KeyCaps keys={shortcutLabel(combination, platform).split(/\+(?!$)/)} />
  ) : (
    <span className="text-xs text-muted-foreground">Unassigned</span>
  );
}

export function SettingsShortcutRow({
  entry,
  platform,
  current,
  defaultKeys,
  customized,
  disabled,
  saving,
  recording,
  preparing,
  proposed,
  onRecord,
  onClear,
  onCancel,
  onSave,
}: {
  entry: ShortcutCommandDefinition;
  platform: AppPlatform;
  current: ShortcutCombination | null | undefined;
  defaultKeys: ShortcutCombination | null;
  customized: boolean;
  disabled: boolean;
  saving: boolean;
  recording: boolean;
  preparing: boolean;
  proposed: { combination: ShortcutCombination | null } | null;
  onRecord(element: HTMLElement): void;
  onClear(element: HTMLElement): void;
  onCancel(): void;
  onSave(): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const editing = recording || proposed !== null;
  return (
    <div className={editing ? "bg-accent/40" : ""}>
      <div className="flex min-h-12 items-center gap-3 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{entry.label}</p>
          {entry.context !== "app" && (
            <p className="text-xs text-muted-foreground">
              {entry.unavailableReason ?? CONTEXT_LABELS[entry.context]}
            </p>
          )}
        </div>
        {customized && <span className="text-xs text-muted-foreground">Custom</span>}
        <Button
          ref={trigger}
          variant="ghost"
          size="sm"
          className="min-w-24 justify-end px-2 hover:bg-accent"
          aria-label={`Record shortcut for ${entry.label}`}
          title={`Default: ${shortcutLabel(defaultKeys, platform)}. ${entry.allowInput ? "Also available while typing." : "Unavailable while typing or using a terminal."}`}
          disabled={disabled}
          onClick={(event) => onRecord(event.currentTarget)}
        >
          {current === undefined ? (
            <span className="text-xs text-muted-foreground">Unavailable</span>
          ) : (
            <ShortcutKeys combination={current} platform={platform} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Clear shortcut for ${entry.label}`}
          title="Clear shortcut"
          disabled={disabled || !current}
          onClick={() => {
            if (trigger.current) onClear(trigger.current);
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {recording ? (
              <p role="status">
                {preparing ? "Preparing recorder…" : "Press your shortcut. Escape cancels."}
              </p>
            ) : (
              proposed && (
                <div className="flex items-center gap-2 text-foreground">
                  <span>New shortcut</span>
                  <ShortcutKeys combination={proposed.combination} platform={platform} />
                </div>
              )
            )}
            <div className="flex items-center gap-2">
              <span>Default</span>
              <ShortcutKeys combination={defaultKeys} platform={platform} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            {proposed && (
              <Button size="sm" disabled={disabled} onClick={onSave}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
