import { memo, type ReactNode, useRef } from "react";
import { ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
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
import type { ShortcutRowActions } from "./use-shortcut-editor";
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
      /** Recorded keys that need a choice before they go into the draft. */
      state: "proposed";
      combination: ShortcutCombination;
      problem: ShortcutProblem;
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

/**
 * One command: its name, its keys, and the inline recorder. Memoized: a list re-render, such as a
 * search key, renders only rows whose own props changed.
 */
export const SettingsShortcutRow = memo(function SettingsShortcutRow({
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
  note,
  actions,
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
  /** Other devices where just-changed keys will not work, such as "on Windows". */
  note: readonly string[];
  /** Stable across renders; each call names this row's command. */
  actions: ShortcutRowActions;
}) {
  const { id } = entry;
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
          note={note}
          inactiveReason={inactiveReason}
          when={
            whenChoice && !editor ? (
              <WhenPicker
                entry={entry}
                disabled={disabled}
                onChoose={(when, element) => actions.chooseWhen(id, when, element)}
              />
            ) : null
          }
          platform={platform}
        />
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {!editor && !disabled && (
          <RowActions
            label={entry.label}
            resetKeys={customized ? defaultKeys : null}
            platform={platform}
            assigned={Boolean(current)}
            onRestoreDefault={() => field.current && actions.assign(id, defaultKeys, field.current)}
            onClear={() => field.current && actions.assign(id, null, field.current)}
          />
        )}
        <Button
          ref={field}
          data-shortcut-id={entry.id}
          type="button"
          variant="ghost"
          aria-label={fieldLabel(entry.label, current, proposal?.combination ?? null, platform)}
          aria-pressed={recording}
          aria-describedby={proposal ? `shortcut-problem-${entry.id}` : undefined}
          disabled={disabled || current === undefined}
          onClick={(event) => {
            if (!recording) actions.record(id, event.currentTarget);
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
        {editor && <CancelButton onCancel={actions.cancel} />}
      </div>
      {proposal && (
        <ProblemCallout
          id={entry.id}
          label={entry.label}
          proposal={proposal}
          platform={platform}
          onReplace={actions.replace}
          onRecordAgain={() => field.current && actions.record(id, field.current)}
        />
      )}
    </li>
  );
});

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
    editor?.state === "proposed" &&
      (editor.problem.conflict ? "border-warning-border" : "border-destructive"),
  );

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
  note,
  inactiveReason,
  when,
  platform,
}: {
  entry: ShortcutCommandDefinition;
  showContext: boolean;
  editor: ShortcutRowEditor | null;
  note: readonly string[];
  inactiveReason: string | undefined;
  /** The picker of a command whose `when` the user may change. */
  when: ReactNode;
  platform: AppPlatform;
}) {
  if (editor?.state === "recording") return <RecordingHint editor={editor} platform={platform} />;
  if (note.length > 0)
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        These keys will not work {joinNames(note)}.
      </p>
    );
  if (inactiveReason)
    return (
      <p className="flex items-center gap-1.5 text-xs leading-5 text-warning-muted">
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        Off on this device. {inactiveReason}
      </p>
    );
  if (entry.unavailableReason)
    return <p className="text-xs leading-5 text-muted-foreground">{entry.unavailableReason}</p>;
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
  disabled: boolean;
  /** Receives the trigger, which takes focus back after the change. */
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

/** "A", "A and B", or "A, B and C"; "on A and B" when each name starts with "on". */
const joinNames = (names: readonly string[]): string => {
  if (names.length > 1 && names.every((name) => name.startsWith("on ")))
    return `on ${joinNames(names.map((name) => name.slice(3)))}`;
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

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
      <p className="text-xs leading-5 text-muted-foreground">
        Hold <ModifierNames platform={platform} /> and press a key.
      </p>
    );
  return (
    <p className="text-xs leading-5 text-warning-muted">
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
        {/* The recorder gets ready in a moment; a separate "Starting" text only flashed. */}
        {editor.held.length > 0 ? `${editor.held.join(" ")} …` : "Press keys…"}
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

function CancelButton({ onCancel }: { onCancel(): void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5"
      aria-keyshortcuts="Escape"
      onClick={onCancel}
    >
      Cancel
      <kbd aria-hidden="true" className="font-sans text-[10px] text-muted-foreground">
        Esc
      </kbd>
    </Button>
  );
}

/**
 * Why recorded keys cannot go into the draft, under the row. A conflict names the command that has the keys
 * and says what Replace does; other problems offer only new keys.
 */
function ProblemCallout({
  id,
  label,
  proposal,
  platform,
  onReplace,
  onRecordAgain,
}: {
  id: string;
  label: string;
  proposal: Extract<ShortcutRowEditor, { state: "proposed" }>;
  platform: AppPlatform;
  onReplace(): void;
  onRecordAgain(): void;
}) {
  const { problem } = proposal;
  const { conflict } = problem;
  const keys = (
    <span className="mx-0.5 inline-flex align-middle">
      <ShortcutKeycaps combination={proposal.combination} platform={platform} />
    </span>
  );
  return (
    <div
      id={`shortcut-problem-${id}`}
      role="alert"
      className={cn(
        "flex basis-full flex-col gap-3 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
        conflict
          ? "border-warning-border bg-warning-surface text-warning-surface-foreground"
          : "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm leading-6 font-medium">
            {conflict ? (
              <>
                {keys} is already the shortcut for {conflict.label}
              </>
            ) : (
              <>You cannot use {keys}</>
            )}
          </p>
          <p className="text-xs">
            {conflict
              ? `Replace gives these keys to ${label} and removes them from ${conflict.label}.`
              : problem.message}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {conflict && (
          <Button type="button" size="sm" onClick={onReplace} autoFocus>
            Replace
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRecordAgain}
          autoFocus={!conflict}
        >
          Record other keys
        </Button>
      </div>
    </div>
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
