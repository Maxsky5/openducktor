import type { ReactNode } from "react";
import { useRef } from "react";
import { CircleAlert, LoaderCircle, Plus, RotateCcw, X } from "lucide-react";
import type { AppPlatform, ShortcutCombination } from "@openducktor/contracts";
import { shortcutKeyParts } from "@openducktor/frontend-core/shortcuts/key-labels";
import {
  scopeLabel,
  type ShortcutCommandDefinition,
  type ShortcutProblem,
} from "@/features/shortcuts/catalogue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ShortcutKeycaps({
  combination,
  platform,
  className,
}: {
  combination: ShortcutCombination;
  platform: AppPlatform;
  className?: string;
}) {
  return (
    <kbd className={cn("inline-flex items-center gap-1 font-sans", className)}>
      {shortcutKeyParts(combination, platform).map((key, index) => (
        <kbd
          key={`${index}-${key}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border border-b-2 bg-background px-1.5 text-xs font-medium leading-none text-foreground shadow-xs"
        >
          {key}
        </kbd>
      ))}
    </kbd>
  );
}

export type ShortcutRowEditor =
  | { state: "recording"; preparing: boolean }
  | {
      state: "proposed";
      combination: ShortcutCombination;
      problem: ShortcutProblem | null;
      /** Other devices of this host where the proposal would not run. */
      otherDevices: readonly string[];
      saving: boolean;
    };

/** The look of the keys field: recording, a proposal, an inactive assignment, or idle. */
const fieldClassName = (
  editor: ShortcutRowEditor | null,
  problem: ShortcutProblem | null,
  inactiveReason: string | undefined,
  shown: ShortcutCombination | null | undefined,
) => {
  const base = "h-8 min-w-32 justify-end gap-2 rounded-lg border px-2 font-normal";
  if (editor?.state === "recording")
    return cn(base, "border-primary bg-background ring-2 ring-primary/20");
  if (editor)
    return cn(base, "bg-background", problem ? "border-destructive-border" : "border-primary");
  if (inactiveReason)
    return cn(
      base,
      "border-dashed border-warning-border text-muted-foreground line-through decoration-muted-foreground/60",
    );
  if (shown) return cn(base, "border-transparent hover:border-border hover:bg-background");
  return cn(
    base,
    "border-transparent text-muted-foreground/70 group-hover/shortcut:border-dashed group-hover/shortcut:border-border group-hover/shortcut:text-muted-foreground hover:bg-background hover:text-foreground focus-visible:text-foreground",
  );
};

/** One command: its name and context, its keys, and the inline recorder. */
export function SettingsShortcutRow({
  entry,
  label,
  showContext = true,
  platform,
  current,
  inactiveReason,
  defaultKeys,
  customized,
  disabled,
  editor,
  onRecord,
  onClear,
  onRestoreDefault,
  onCancel,
  onSave,
  onReassign,
}: {
  entry: ShortcutCommandDefinition;
  label: string;
  /** False inside a folded family, whose row already names the context. */
  showContext?: boolean;
  platform: AppPlatform;
  current: ShortcutCombination | null | undefined;
  inactiveReason: string | undefined;
  defaultKeys: ShortcutCombination | null;
  customized: boolean;
  disabled: boolean;
  editor: ShortcutRowEditor | null;
  onRecord(element: HTMLElement): void;
  onClear(element: HTMLElement): void;
  onRestoreDefault(element: HTMLElement): void;
  onCancel(): void;
  onSave(): void;
  onReassign(): void;
}) {
  const field = useRef<HTMLButtonElement>(null);
  const context = entry.unavailableReason ?? (showContext ? scopeLabel(entry.scope) : undefined);
  const recording = editor?.state === "recording";
  const proposed = editor?.state === "proposed" ? editor : null;
  const problem = proposed?.problem ?? null;
  const shown = proposed ? proposed.combination : current;
  return (
    <li
      className={cn(
        "group/shortcut list-none px-4 py-1.5 transition-colors",
        editor ? "bg-accent/40" : "hover:bg-accent/25",
      )}
    >
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm leading-5 text-foreground">{label}</p>
          <RowDetails
            context={context}
            customized={customized}
            defaultKeys={defaultKeys}
            platform={platform}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            ref={field}
            type="button"
            variant="ghost"
            aria-label={`Record shortcut for ${entry.label}`}
            aria-describedby={problem ? `shortcut-problem-${entry.id}` : undefined}
            disabled={disabled || current === undefined}
            onClick={(event) => onRecord(event.currentTarget)}
            className={fieldClassName(editor, problem, inactiveReason, shown)}
          >
            <FieldContent
              recording={recording}
              preparing={editor?.state === "recording" && editor.preparing}
              combination={shown}
              platform={platform}
            />
          </Button>
          {proposed ? (
            <ProposalActions proposal={proposed} onSave={onSave} onCancel={onCancel} />
          ) : (
            !editor &&
            !disabled && (
              <RowActions
                label={entry.label}
                customized={customized}
                assigned={Boolean(current)}
                onRestoreDefault={() => field.current && onRestoreDefault(field.current)}
                onClear={() => field.current && onClear(field.current)}
              />
            )
          )}
        </div>
      </div>
      <RowMessages
        entry={entry}
        editor={editor}
        inactiveReason={inactiveReason}
        platform={platform}
        onReassign={onReassign}
        onRecordAgain={() => field.current && onRecord(field.current)}
      />
    </li>
  );
}

function RowDetails({
  context,
  customized,
  defaultKeys,
  platform,
}: {
  context: string | undefined;
  customized: boolean;
  defaultKeys: ShortcutCombination | null;
  platform: AppPlatform;
}) {
  if (!context && !customized) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-5 text-muted-foreground">
      {context && <span className="truncate">{context}</span>}
      {context && customized && <span aria-hidden="true">·</span>}
      {customized && (
        <span className="inline-flex items-center gap-1">
          Default{" "}
          {defaultKeys ? (
            <ShortcutKeycaps
              combination={defaultKeys}
              platform={platform}
              className="[&>kbd]:h-4.5 [&>kbd]:min-w-4.5 [&>kbd]:border-b [&>kbd]:px-1 [&>kbd]:text-[10px] [&>kbd]:text-muted-foreground [&>kbd]:shadow-none"
            />
          ) : (
            "none"
          )}
        </span>
      )}
    </p>
  );
}

function FieldContent({
  recording,
  preparing,
  combination,
  platform,
}: {
  recording: boolean;
  preparing: boolean;
  combination: ShortcutCombination | null | undefined;
  platform: AppPlatform;
}) {
  if (recording)
    return (
      <span className="flex items-center gap-2 text-sm text-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full bg-primary",
            !preparing && "animate-pulse motion-reduce:animate-none",
          )}
        />
        {preparing ? "Starting…" : "Recording…"}
      </span>
    );
  if (combination === undefined)
    return <span className="text-xs text-muted-foreground">Unavailable</span>;
  if (combination === null)
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <Plus aria-hidden="true" className="size-3.5" />
        Add shortcut
      </span>
    );
  return <ShortcutKeycaps combination={combination} platform={platform} />;
}

function IconAction({
  label,
  hoverOnly = false,
  onClick,
  children,
}: {
  label: string;
  hoverOnly?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "size-8 text-muted-foreground hover:text-foreground",
        hoverOnly &&
          "[@media(hover:hover)]:opacity-0 group-focus-within/shortcut:opacity-100 group-hover/shortcut:opacity-100",
      )}
    >
      {children}
    </Button>
  );
}

function ProposalActions({
  proposal,
  onSave,
  onCancel,
}: {
  proposal: Extract<ShortcutRowEditor, { state: "proposed" }>;
  onSave(): void;
  onCancel(): void;
}) {
  return (
    <>
      {proposal.problem === null && (
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={proposal.saving}
          onClick={onSave}
          autoFocus
        >
          {proposal.saving && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {proposal.saving ? "Saving…" : "Save"}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8"
        disabled={proposal.saving}
        onClick={onCancel}
      >
        Cancel
      </Button>
    </>
  );
}

function RowActions({
  label,
  customized,
  assigned,
  onRestoreDefault,
  onClear,
}: {
  label: string;
  customized: boolean;
  assigned: boolean;
  onRestoreDefault(): void;
  onClear(): void;
}) {
  return (
    <div className="flex w-16 justify-end">
      {customized && (
        <IconAction label={`Restore default shortcut for ${label}`} onClick={onRestoreDefault}>
          <RotateCcw aria-hidden="true" />
        </IconAction>
      )}
      {assigned && (
        <IconAction label={`Remove shortcut for ${label}`} hoverOnly onClick={onClear}>
          <X aria-hidden="true" />
        </IconAction>
      )}
    </div>
  );
}

/** The recorder prompt, the reason an assignment is off here, and proposal problems. */
function RowMessages({
  entry,
  editor,
  inactiveReason,
  platform,
  onReassign,
  onRecordAgain,
}: {
  entry: ShortcutCommandDefinition;
  editor: ShortcutRowEditor | null;
  inactiveReason: string | undefined;
  platform: AppPlatform;
  onReassign(): void;
  onRecordAgain(): void;
}) {
  if (editor?.state === "recording")
    return (
      <p role="status" className="mt-1.5 text-right text-xs text-muted-foreground">
        {editor.preparing
          ? "Preparing the recorder…"
          : `Press a key with ${platform === "darwin" ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"}. Press Esc to cancel.`}
      </p>
    );
  if (!editor)
    return inactiveReason ? (
      <p className="mt-1.5 flex items-center justify-end gap-1.5 text-right text-xs text-warning-muted">
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        Off on this device: {inactiveReason}
      </p>
    ) : null;
  const { problem } = editor;
  if (!problem)
    return editor.otherDevices.length > 0 ? (
      <p className="mt-1.5 text-right text-xs text-muted-foreground">
        These keys will not work in {editor.otherDevices.join(", ")}.
      </p>
    ) : null;
  return (
    <div
      id={`shortcut-problem-${entry.id}`}
      role="alert"
      className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-xs"
    >
      <span className="text-destructive-muted">
        {problem.conflict ? (
          <>
            Already used by <span className="font-medium">{problem.conflict.label}</span>.
          </>
        ) : (
          problem.message
        )}
      </span>
      {problem.conflict && (
        <Button type="button" size="xs" variant="outline" onClick={onReassign}>
          Use here instead
        </Button>
      )}
      <Button type="button" size="xs" variant="ghost" onClick={onRecordAgain}>
        Record again
      </Button>
    </div>
  );
}
