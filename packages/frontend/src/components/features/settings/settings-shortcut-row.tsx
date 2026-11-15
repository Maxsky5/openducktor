import { type ReactNode, useRef } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import type { AppPlatform, ShortcutCombination, ShortcutWhen } from "@openducktor/contracts";
import {
  shortcutKeyParts,
  shortcutLabel,
  spokenShortcut,
} from "@openducktor/frontend-core/shortcuts/key-labels";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import {
  type ShortcutCommandDefinition,
  type ShortcutProblem,
  whenLabel,
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
      <KbdGroup aria-hidden="true" className="gap-1">
        {shortcutKeyParts(combination, platform).map((key, index) => (
          <Kbd
            key={`${index}-${key}`}
            className="h-6 min-w-6 rounded-md px-1.5 text-xs text-foreground"
          >
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
  resetKeys,
  platform,
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
  /** The default keys that Reset restores, when the keys differ from a default. */
  resetKeys: ShortcutCombination | null;
  platform: AppPlatform;
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
          resetKeys={resetKeys}
          platform={platform}
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
  whenChoice,
  whenCustomized,
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
  onChooseWhen,
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
  /** The user may change when the command runs. */
  whenChoice: boolean;
  whenCustomized: boolean;
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
  onChooseWhen(when: ShortcutWhen, element: HTMLElement): void;
}) {
  const field = useRef<HTMLButtonElement>(null);
  const recording = editor?.state === "recording";
  const proposal = editor?.state === "proposed" ? editor : null;
  return (
    <li className="group/row flex min-h-16 list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <RowTitle label={label} badge={changeBadge(customized, whenCustomized, current)} />
        <RowDetail
          entry={entry}
          showContext={showContext}
          editor={editor}
          removed={removed}
          inactiveReason={inactiveReason}
          defaultKeys={defaultKeys}
          when={
            whenChoice && !editor ? (
              <WhenPicker entry={entry} disabled={disabled} onChoose={onChooseWhen} />
            ) : null
          }
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
            resetKeys={customized ? defaultKeys : null}
            platform={platform}
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
          className={keyFieldClassName(editor)}
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

/** "Removed" when the user cleared default keys, "Custom" for any other change. */
const changeBadge = (
  customized: boolean,
  whenCustomized: boolean,
  current: ShortcutCombination | null | undefined,
): string | null => {
  if (customized && current === null) return "Removed";
  return customized || whenCustomized ? "Custom" : null;
};

function RowTitle({ label, badge }: { label: string; badge: string | null }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm font-medium break-words text-foreground">
      {label}
      {badge && (
        <Badge
          variant="outline"
          className="rounded-md px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
        >
          {badge}
        </Badge>
      )}
    </p>
  );
}

/** While editing, the keys look like a field: the input chrome, and its focus border. */
const keyFieldClassName = (editor: ShortcutRowEditor | null) =>
  cn(
    "h-8 min-w-16 justify-end gap-1 px-2 font-normal",
    editor && "border border-input bg-card shadow-sm hover:bg-card",
    editor?.state === "recording" && "border-ring",
    editor?.state === "proposed" && editor.problem && "border-destructive",
  );

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

/** One quiet line under the name: guidance, a problem, or when the command runs. */
function RowDetail({
  entry,
  showContext,
  editor,
  removed,
  inactiveReason,
  defaultKeys,
  when,
  platform,
}: {
  entry: ShortcutCommandDefinition;
  showContext: boolean;
  editor: ShortcutRowEditor | null;
  removed: boolean;
  inactiveReason: string | undefined;
  defaultKeys: ShortcutCombination | null;
  /** The picker of a command whose `when` the user may change. */
  when: ReactNode;
  platform: AppPlatform;
}) {
  if (editor && hasEditorDetail(editor))
    return <EditorDetail id={entry.id} editor={editor} platform={platform} />;
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
  if (entry.unavailableReason)
    return <p className="text-xs text-muted-foreground">{entry.unavailableReason}</p>;
  if (!showContext) return null;
  return (
    <div className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
      When
      {when ?? <span className="text-foreground/80">{whenLabel(entry)}</span>}
    </div>
  );
}

const WHEN_DESCRIPTIONS = {
  always: "Also while typing in an editor, terminal or page.",
  "not-typing": "Editors, terminals and pages keep these keys.",
} as const satisfies Record<ShortcutWhen, string>;

/** The `when` choice of an app-wide command, labeled as the row shows it. */
function WhenPicker({
  entry,
  disabled,
  onChoose,
}: {
  entry: ShortcutCommandDefinition;
  /** Stays mounted while another edit runs, so focus can return to it after a save. */
  disabled: boolean;
  /** Receives the trigger, which takes focus back after the save. */
  onChoose(when: ShortcutWhen, trigger: HTMLElement): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const current: ShortcutWhen = entry.allowInput ? "always" : "not-typing";
  const labelOf = (when: ShortcutWhen) => whenLabel({ ...entry, allowInput: when === "always" });
  return (
    <Combobox
      value={current}
      searchable={false}
      className="w-88"
      options={(["always", "not-typing"] as const).map((when) => ({
        value: when,
        label: labelOf(when),
        description: WHEN_DESCRIPTIONS[when],
      }))}
      onValueChange={(value) => {
        if (value !== current && (value === "always" || value === "not-typing") && trigger.current)
          onChoose(value, trigger.current);
      }}
      trigger={
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-label={`When ${entry.label} runs: ${labelOf(current)}`}
          className="-mx-1 inline-flex h-5 items-center gap-1 rounded-md px-1 text-xs text-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {labelOf(current)}
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </button>
      }
    />
  );
}

/** Guidance while recording, and the problem or reach of proposed keys. */
/** Keys waiting for Save with nothing to report keep the When line, so the row keeps its height. */
const hasEditorDetail = (editor: ShortcutRowEditor) =>
  editor.state === "recording" || editor.problem !== null || editor.otherDevices.length > 0;

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
  resetKeys,
  platform,
  assigned,
  onRestoreDefault,
  onClear,
}: {
  label: string;
  resetKeys: ShortcutCombination | null;
  platform: AppPlatform;
  assigned: boolean;
  onRestoreDefault(): void;
  onClear(): void;
}) {
  return (
    <div className="flex items-center opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
      {resetKeys && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Reset shortcut for ${label} to its default, ${spokenShortcut(resetKeys, platform)}`}
          onClick={onRestoreDefault}
        >
          Reset to <span aria-hidden="true">{shortcutLabel(resetKeys, platform)}</span>
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
