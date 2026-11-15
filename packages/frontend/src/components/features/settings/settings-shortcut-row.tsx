import { useRef } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { AppPlatform, ShortcutCombination } from "@openducktor/contracts";
import {
  shortcutKeyParts,
  shortcutLabel,
  spokenShortcut,
} from "@openducktor/frontend-core/shortcuts/key-labels";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  scopeLabel,
  type ShortcutCommandDefinition,
  type ShortcutProblem,
} from "@/features/shortcuts/catalogue";
import { typesText } from "@/features/shortcuts/recording";
import { cn } from "@/lib/utils";

/** The keys as design-system keycaps, spoken as words. */
export function ShortcutKeycaps({
  combination,
  platform,
}: {
  combination: ShortcutCombination;
  platform: AppPlatform;
}) {
  return (
    <>
      <KbdGroup aria-hidden="true">
        {shortcutKeyParts(combination, platform).map((key, index) => (
          <Kbd key={`${index}-${key}`} className="text-foreground">
            {key}
          </Kbd>
        ))}
      </KbdGroup>
      <span className="sr-only">{spokenShortcut(combination, platform)}</span>
    </>
  );
}

export type ShortcutRowEditor =
  | {
      state: "recording";
      preparing: boolean;
      /** Modifiers held now, shown live so the recorder visibly listens. */
      held: readonly string[];
      /** A key pressed without a modifier, which cannot be a shortcut. */
      ignored: string | null;
    }
  | {
      state: "proposed";
      combination: ShortcutCombination;
      problem: ShortcutProblem | null;
      /** Other devices of this host where the proposal would not run. */
      otherDevices: readonly string[];
      saving: boolean;
    };

/** The key button name: the command, its keys in words, and what a press does. */
const fieldLabel = (
  label: string,
  current: ShortcutCombination | null | undefined,
  proposed: ShortcutCombination | null,
  platform: AppPlatform,
) => {
  if (proposed) return `${label}, new keys ${spokenShortcut(proposed, platform)}. Change shortcut`;
  if (current) return `${label}, ${spokenShortcut(current, platform)}. Change shortcut`;
  return `${label}, no keys. ${current === null ? "Add keys" : "Change shortcut"}`;
};

/** Undo after a removal, the brief "Saved" check, and Reset and Remove. */
function IdleControls({
  label,
  id,
  removed,
  saved,
  showActions,
  canReset,
  assigned,
  onUndo,
  onRestoreDefault,
  onClear,
}: {
  label: string;
  id: string;
  removed: boolean;
  saved: boolean;
  showActions: boolean;
  canReset: boolean;
  assigned: boolean;
  onUndo(): void;
  onRestoreDefault(): void;
  onClear(): void;
}) {
  if (removed)
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-describedby={`shortcut-removed-${id}`}
        onClick={onUndo}
        autoFocus
      >
        Undo
      </Button>
    );
  return (
    <>
      {showActions && (
        <RowActions
          label={label}
          canReset={canReset}
          assigned={assigned}
          onRestoreDefault={onRestoreDefault}
          onClear={onClear}
        />
      )}
      {saved && (
        <span className="flex items-center gap-1 text-xs text-success-muted">
          <Check aria-hidden="true" className="size-3.5" /> Saved
        </span>
      )}
    </>
  );
}

/** One command: its name, its keys, and the inline recorder. Editing stays on one line. */
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
  saved,
  removed,
  onUndo,
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
  /** True for a moment after this row saved, to confirm the change. */
  saved: boolean;
  /** True right after its keys were removed: the row offers Undo in place. */
  removed: boolean;
  onUndo(): void;
  onRecord(element: HTMLElement): void;
  onClear(element: HTMLElement): void;
  onRestoreDefault(element: HTMLElement): void;
  onCancel(): void;
  onSave(): void;
  onReassign(): void;
}) {
  const field = useRef<HTMLButtonElement>(null);
  const recording = editor?.state === "recording";
  const proposal = editor?.state === "proposed" ? editor : null;
  return (
    <li className="group/row flex min-h-12 list-none flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
      <div className="flex min-w-40 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium break-words text-foreground">{label}</p>
        <RowDetail
          entry={entry}
          showContext={showContext}
          editor={editor}
          removed={removed}
          inactiveReason={inactiveReason}
          customized={customized}
          current={current}
          defaultKeys={defaultKeys}
          platform={platform}
        />
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {!editor && (
          <IdleControls
            label={entry.label}
            id={entry.id}
            removed={removed}
            saved={saved}
            showActions={!disabled}
            canReset={customized && defaultKeys !== null}
            assigned={Boolean(current)}
            onUndo={onUndo}
            onRestoreDefault={() => field.current && onRestoreDefault(field.current)}
            onClear={() => field.current && onClear(field.current)}
          />
        )}
        <Button
          ref={field}
          data-shortcut-id={entry.id}
          type="button"
          variant="ghost"
          aria-label={fieldLabel(entry.label, current, proposal?.combination ?? null, platform)}
          aria-pressed={recording}
          aria-describedby={proposal?.problem ? `shortcut-problem-${entry.id}` : undefined}
          disabled={disabled || current === undefined}
          onClick={(event) => {
            if (!recording) onRecord(event.currentTarget);
          }}
          className={cn(
            "h-8 min-w-16 justify-end gap-1 px-2 font-normal",
            // While editing, the keys look like a field: the input chrome, and its focus border.
            editor && "border border-input bg-card shadow-sm hover:bg-card",
            recording && "border-ring",
            proposal?.problem && "border-destructive",
          )}
        >
          <KeyField
            editor={editor}
            current={current}
            inactive={Boolean(inactiveReason)}
            platform={platform}
          />
        </Button>
        {editor && (
          <EditActions
            id={entry.id}
            proposal={proposal}
            onSave={onSave}
            onReassign={onReassign}
            onRecordAgain={() => field.current && onRecord(field.current)}
            onCancel={onCancel}
          />
        )}
      </div>
    </li>
  );
}

/** Keys inside text: symbols in the system font for the eye, words for screen readers. */
function KeysText({
  combination,
  platform,
}: {
  combination: ShortcutCombination;
  platform: AppPlatform;
}) {
  return (
    <>
      <span aria-hidden="true">{shortcutLabel(combination, platform)}</span>
      <span className="sr-only">{spokenShortcut(combination, platform)}</span>
    </>
  );
}

/** The modifiers that a shortcut needs, as text. */
function ModifierNames({ platform }: { platform: AppPlatform }) {
  if (platform !== "darwin") return <>Ctrl or Alt</>;
  return (
    <>
      <span aria-hidden="true">⌘ ⌃ or ⌥</span>
      <span className="sr-only">Command, Control or Option</span>
    </>
  );
}

/** One quiet line under the name: guidance, a problem, the context, or a change. */
function RowDetail({
  entry,
  showContext,
  editor,
  removed,
  inactiveReason,
  customized,
  current,
  defaultKeys,
  platform,
}: {
  entry: ShortcutCommandDefinition;
  showContext: boolean;
  editor: ShortcutRowEditor | null;
  removed: boolean;
  inactiveReason: string | undefined;
  customized: boolean;
  current: ShortcutCombination | null | undefined;
  defaultKeys: ShortcutCombination | null;
  platform: AppPlatform;
}) {
  if (editor) return <EditorDetail id={entry.id} editor={editor} platform={platform} />;
  if (removed)
    return (
      <p id={`shortcut-removed-${entry.id}`} className="text-xs text-muted-foreground">
        Shortcut removed
        {defaultKeys && (
          <>
            {" "}
            · default <KeysText combination={defaultKeys} platform={platform} />
          </>
        )}
      </p>
    );
  if (inactiveReason)
    return (
      <p className="flex items-center gap-1.5 text-xs text-warning-muted">
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        Off on this device. {inactiveReason}
      </p>
    );
  const context = entry.unavailableReason ?? (showContext ? scopeLabel(entry.scope) : undefined);
  const change = customized ? (
    <ChangeText current={current} defaultKeys={defaultKeys} platform={platform} />
  ) : null;
  if (!context && !change) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {context}
      {context && change && " · "}
      {change}
    </p>
  );
}

/** How changed keys differ from the default. */
function ChangeText({
  current,
  defaultKeys,
  platform,
}: {
  current: ShortcutCombination | null | undefined;
  defaultKeys: ShortcutCombination | null;
  platform: AppPlatform;
}) {
  if (!defaultKeys) return <>Added by you</>;
  return (
    <>
      {current ? "Changed from " : "Removed, default "}
      <KeysText combination={defaultKeys} platform={platform} />
    </>
  );
}

/** Guidance while recording, and the problem or reach of proposed keys. */
function EditorDetail({
  id,
  editor,
  platform,
}: {
  id: string;
  editor: ShortcutRowEditor;
  platform: AppPlatform;
}) {
  if (editor.state === "recording") return <RecordingHint editor={editor} platform={platform} />;
  const { problem } = editor;
  if (problem?.conflict)
    return (
      <p
        id={`shortcut-problem-${id}`}
        role="alert"
        className="text-xs break-words text-muted-foreground"
      >
        <span className="text-destructive-surface-foreground">
          Used by {problem.conflict.label}.
        </span>{" "}
        Moving the keys removes them there.
      </p>
    );
  if (problem)
    return (
      <p
        id={`shortcut-problem-${id}`}
        role="alert"
        className="text-xs text-destructive-surface-foreground"
      >
        {problem.message}
      </p>
    );
  if (editor.otherDevices.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      These keys will not work in {editor.otherDevices.join(", ")}.
    </p>
  );
}

function RecordingHint({
  editor,
  platform,
}: {
  editor: Extract<ShortcutRowEditor, { state: "recording" }>;
  platform: AppPlatform;
}) {
  const { ignored } = editor;
  if (!ignored)
    return (
      <p className="text-xs text-muted-foreground">
        Hold <ModifierNames platform={platform} /> and press a key.
      </p>
    );
  return (
    <p className="text-xs text-warning-muted">
      {typesText(ignored) ? (
        <>
          Add <ModifierNames platform={platform} />. {ignored} alone types text.
        </>
      ) : (
        <>
          {ignored} needs <ModifierNames platform={platform} />.
        </>
      )}
    </p>
  );
}

/** The keys, the recorder prompt, or "Add keys" on a command without keys. */
function KeyField({
  editor,
  current,
  inactive,
  platform,
}: {
  editor: ShortcutRowEditor | null;
  current: ShortcutCombination | null | undefined;
  inactive: boolean;
  platform: AppPlatform;
}) {
  if (editor?.state === "recording")
    return (
      <span className="px-1 text-xs text-foreground">
        {editor.preparing
          ? "Starting…"
          : editor.held.length > 0
            ? `${editor.held.join(" ")} …`
            : "Press keys…"}
      </span>
    );
  if (editor) return <ShortcutKeycaps combination={editor.combination} platform={platform} />;
  if (current === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  if (current === null)
    return (
      <span className="px-1 text-xs text-muted-foreground group-hover/row:text-foreground">
        Add keys
      </span>
    );
  return (
    <span className={cn(inactive && "opacity-50")}>
      <ShortcutKeycaps combination={current} platform={platform} />
    </span>
  );
}

function EditActions({
  id,
  proposal,
  onSave,
  onReassign,
  onRecordAgain,
  onCancel,
}: {
  id: string;
  proposal: Extract<ShortcutRowEditor, { state: "proposed" }> | null;
  onSave(): void;
  onReassign(): void;
  onRecordAgain(): void;
  onCancel(): void;
}) {
  const saving = proposal?.saving ?? false;
  const problem = proposal?.problem ?? null;
  return (
    <>
      {proposal && !problem && (
        <Button
          type="button"
          size="sm"
          aria-disabled={saving}
          onClick={() => {
            if (!saving) onSave();
          }}
          autoFocus
        >
          {saving && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
      {problem?.conflict && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={saving}
          aria-describedby={`shortcut-problem-${id}`}
          onClick={() => {
            if (!saving) onReassign();
          }}
          autoFocus
        >
          Move keys here
        </Button>
      )}
      {problem && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRecordAgain}
          autoFocus={!problem.conflict}
        >
          Try other keys
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5"
        disabled={saving}
        aria-keyshortcuts="Escape"
        onClick={onCancel}
      >
        Cancel
        <kbd aria-hidden="true" className="font-sans text-[10px] text-muted-foreground">
          Esc
        </kbd>
      </Button>
    </>
  );
}

/** Reset and Remove appear on hover or keyboard focus, so idle rows stay quiet. */
function RowActions({
  label,
  canReset,
  assigned,
  onRestoreDefault,
  onClear,
}: {
  label: string;
  canReset: boolean;
  assigned: boolean;
  onRestoreDefault(): void;
  onClear(): void;
}) {
  return (
    <div className="flex items-center opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
      {canReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Reset shortcut for ${label} to its default`}
          onClick={onRestoreDefault}
        >
          Reset
        </Button>
      )}
      {assigned && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Remove shortcut for ${label}`}
          onClick={onClear}
        >
          Remove
        </Button>
      )}
    </div>
  );
}
