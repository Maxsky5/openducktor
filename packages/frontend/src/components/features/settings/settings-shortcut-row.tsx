import { useRef } from "react";
import { Keyboard, LoaderCircle, Pencil, Plus, Save, X } from "lucide-react";
import type { AppPlatform, ShortcutCombination } from "@openducktor/contracts";
import { shortcutLabel } from "@openducktor/frontend-core/shortcuts/key-matching";
import type { ShortcutCommandDefinition } from "@/features/shortcuts/catalogue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const CONTEXT_LABELS = {
  app: undefined,
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
    <KbdGroup className="flex-wrap justify-end gap-1">
      {shortcutLabel(combination, platform)
        .split(/\+(?!$)/)
        .map((key) => (
          <Kbd
            key={key}
            className="h-7 min-w-7 rounded-md border-b-2 bg-background px-2 text-xs text-foreground shadow-xs"
          >
            {key}
          </Kbd>
        ))}
    </KbdGroup>
  ) : (
    <span className="text-xs text-muted-foreground">Unassigned</span>
  );
}

function ShortcutAssignment({
  current,
  platform,
}: {
  current: ShortcutCombination | null | undefined;
  platform: AppPlatform;
}) {
  if (current === undefined)
    return <span className="text-xs text-muted-foreground">Unavailable</span>;
  return (
    <>
      {!current && <Plus aria-hidden="true" className="text-muted-foreground" />}
      <ShortcutKeys combination={current} platform={platform} />
      {current && (
        <Pencil
          aria-hidden="true"
          className="text-muted-foreground opacity-0 group-hover/shortcut:opacity-100 group-focus-within/shortcut:opacity-100"
        />
      )}
    </>
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
  const contextLabel = entry.unavailableReason ?? CONTEXT_LABELS[entry.context];
  return (
    <div className={cn("group/shortcut", editing ? "bg-accent/50" : "hover:bg-accent/30")}>
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:flex-nowrap">
        <div className="min-w-0 flex-1 basis-40 sm:basis-auto">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium leading-5">{entry.label}</p>
            {customized && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                Custom
              </Badge>
            )}
          </div>
          {contextLabel && (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{contextLabel}</p>
          )}
        </div>
        <div className="flex max-w-full shrink-0 items-center gap-1">
          <Button
            ref={trigger}
            variant="ghost"
            size="sm"
            className="h-auto min-h-9 min-w-0 shrink gap-2 rounded-lg px-2 py-1"
            aria-label={`Record shortcut for ${entry.label}`}
            title={`Default: ${shortcutLabel(defaultKeys, platform)}. ${entry.allowInput ? "Also available while typing." : "Unavailable while typing or using a terminal."}`}
            disabled={disabled}
            onClick={(event) => onRecord(event.currentTarget)}
          >
            <ShortcutAssignment current={current} platform={platform} />
          </Button>
          {current ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground [@media(hover:hover)]:opacity-0 group-hover/shortcut:opacity-100 group-focus-within/shortcut:opacity-100"
              aria-label={`Clear shortcut for ${entry.label}`}
              title="Clear shortcut"
              disabled={disabled}
              onClick={() => {
                if (trigger.current) onClear(trigger.current);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          ) : (
            <span className="size-8" aria-hidden="true" />
          )}
        </div>
      </div>
      {editing && (
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
          <div className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
            {recording ? (
              <div className="flex items-center gap-2">
                <Keyboard className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <p role="status" className="text-sm font-medium text-foreground">
                  {preparing ? "Preparing recorder…" : "Press your shortcut. Escape cancels."}
                </p>
              </div>
            ) : (
              proposed && (
                <div className="flex flex-wrap items-center gap-3 text-foreground">
                  <span className="text-sm font-medium">New shortcut</span>
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
                {saving ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
