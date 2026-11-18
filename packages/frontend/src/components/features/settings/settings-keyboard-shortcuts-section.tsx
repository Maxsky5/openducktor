import { useMemo, useRef, useState } from "react";
import type { AppPlatform, ShortcutActionId } from "@openducktor/contracts";
import { ChevronDown, RotateCcw, SearchX } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { spokenShortcut } from "@openducktor/frontend-core/shortcuts/key-labels";
import {
  useShortcutCatalogue,
  useShortcutShell,
} from "@/features/shortcuts/use-shortcut-catalogue";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";
import { readDevicePlatform } from "@/lib/device-platform";
import { cn } from "@/lib/utils";
import {
  buildCommandViews,
  groupCommandViews,
  hasChanges,
  positionRowLabel,
  type ShortcutCommandView,
  type ShortcutFamily,
  type ShortcutFilter,
  type ShortcutGroupItem,
  searchKey,
  whenLabel,
} from "./settings-shortcut-model";
import {
  SettingsShortcutRow,
  ShortcutKeycaps,
  type ShortcutRowEditor,
} from "./settings-shortcut-row";
import { ListHeading } from "./settings-prompt-page-header";
import { ROW_LIST_CLASS_NAME } from "./settings-prompt-rows";
import { useShortcutDraftContext } from "./use-shortcut-draft";
import { useShortcutEditor } from "./use-shortcut-editor";

type Editor = ReturnType<typeof useShortcutEditor>;

const FILTERS = [
  { value: "all", label: "All commands" },
  { value: "assigned", label: "Assigned" },
] as const satisfies readonly { value: ShortcutFilter; label: string }[];

/** `disabled` is true while the Settings form loads or saves, the shortcut save included. */
export function SettingsKeyboardShortcutsSection({ disabled }: { disabled: boolean }) {
  const { query, updatesError } = useShortcutPreferences();
  const draft = useShortcutDraftContext();
  const editable = Boolean(draft.preferences) && !disabled;
  const catalogue = useShortcutCatalogue(draft.preferences);
  const platform = readDevicePlatform();
  const shell = useShortcutShell();
  const heading = useRef<HTMLHeadingElement>(null);
  const editor = useShortcutEditor({ catalogue, platform, shell, heading, draft });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ShortcutFilter>("all");
  const views = useMemo(
    () => buildCommandViews(catalogue, draft.preferences, platform, shell),
    [catalogue, draft.preferences, platform, shell],
  );
  const changed = hasChanges(draft.preferences);
  const term = searchKey(search);
  const kept = editor.keptId;
  const groups = useMemo(
    () => groupCommandViews(views, filter, term, kept),
    [views, filter, term, kept],
  );

  const shown: ShortcutFilter = term ? "all" : filter;
  const changeFilter = (next: ShortcutFilter) => {
    if (next !== filter) setFilter(next);
  };

  return (
    <section aria-label="Keyboard shortcuts" className="grid gap-4 p-4">
      <header className="space-y-2">
        <h3
          ref={heading}
          tabIndex={-1}
          className="text-sm font-semibold text-foreground outline-none"
        >
          Keyboard shortcuts
        </h3>
        <p className="text-xs text-muted-foreground">
          Click the keys of a command to change them. Saved shortcuts apply to every app connected
          to this host.
        </p>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {editor.announcement}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <ToolbarSearchField
            id="shortcut-search"
            label="Search commands"
            placeholder={`Search commands or keys, such as ${platform === "darwin" ? "⌘K" : "Ctrl+K"}`}
            size="lg"
            value={search}
            onValueChange={setSearch}
          />
        </div>
        <RadioGroup
          aria-label={term ? "Show: a search shows all commands" : "Show"}
          orientation="horizontal"
          data-variant="segmented"
          className="grid h-9 grid-cols-2 items-center gap-1 rounded-lg bg-muted p-1"
          value={shown}
          disabled={term !== ""}
          onValueChange={(value) => {
            const next = FILTERS.find((option) => option.value === value);
            if (next) changeFilter(next.value);
          }}
        >
          {FILTERS.map((option) => (
            <RadioGroupSegmentItem key={option.value} value={option.value} className="px-3">
              {option.label}
            </RadioGroupSegmentItem>
          ))}
        </RadioGroup>
        {changed && (
          <Button type="button" variant="outline" disabled={!editable} onClick={editor.resetAll}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" /> Reset all
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <ShortcutNotices editor={editor} updatesError={updatesError} disabled={disabled} />
        <ShortcutList
          pending={query.isPending}
          groups={groups}
          term={term}
          onShowAll={() => changeFilter("all")}
          editor={editor}
          platform={platform}
          disabled={!editable}
        />
      </div>
    </section>
  );
}

/** The loading state, the empty state, or the commands by group. */
function ShortcutList({
  pending,
  groups,
  term,
  onShowAll,
  editor,
  platform,
  disabled,
}: {
  pending: boolean;
  groups: ReadonlyMap<string, ShortcutGroupItem[]>;
  term: string;
  onShowAll(): void;
  editor: Editor;
  platform: AppPlatform;
  disabled: boolean;
}) {
  if (pending) return <ShortcutListSkeleton />;
  if (groups.size === 0)
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border px-4 py-10 text-center"
      >
        <SearchX className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
        {term ? (
          <>
            <p className="text-sm font-medium text-foreground">No commands match</p>
            <p className="text-xs text-muted-foreground">Search for another command or key.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">No command has an assignment</p>
            <Button type="button" variant="outline" className="mt-3" onClick={onShowAll}>
              Show all commands
            </Button>
          </>
        )}
      </div>
    );
  return Array.from(groups, ([group, items]) => (
    <section key={group} aria-label={group} className="flex flex-col gap-2">
      <ListHeading title={group} />
      <ul className={ROW_LIST_CLASS_NAME}>
        {items.map((item) =>
          item.kind === "command" ? (
            <CommandRow
              key={item.command.entry.id}
              view={item.command}
              editor={editor}
              platform={platform}
              disabled={disabled}
            />
          ) : (
            <FamilyRows
              key={item.family.key}
              family={item.family}
              editor={editor}
              platform={platform}
              disabled={disabled}
            />
          ),
        )}
      </ul>
    </section>
  ));
}

function ShortcutNotices({
  editor,
  updatesError,
  disabled,
}: {
  editor: Editor;
  updatesError: string | null;
  disabled: boolean;
}) {
  const { query } = useShortcutPreferences();
  const draft = useShortcutDraftContext();
  return (
    <>
      {updatesError && (
        <Alert variant="destructive">
          <p>{updatesError}</p>
        </Alert>
      )}
      {query.error && (
        <Alert variant="destructive" className="items-center justify-between gap-3">
          <p>Shortcuts are turned off until this is fixed. {query.error.message}</p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
            {!draft.preferences && (
              <Button variant="outline" size="sm" disabled={disabled} onClick={editor.resetAll}>
                Reset all
              </Button>
            )}
          </div>
        </Alert>
      )}
      {editor.error && (
        <Alert variant="destructive">
          <p>{editor.error}</p>
        </Alert>
      )}
    </>
  );
}

/** The edit state of one row: recording, a proposal with a problem, or none. */
const rowEditorOf = (editor: Editor, id: ShortcutActionId): ShortcutRowEditor | null => {
  if (editor.recording === id)
    return {
      state: "recording",
      preparing: editor.preparing,
      held: editor.held,
      ignored: editor.ignored,
    };
  const { proposal } = editor;
  if (proposal?.id === id)
    return { state: "proposed", combination: proposal.combination, problem: proposal.problem };
  return null;
};

function CommandRow({
  view,
  editor,
  platform,
  disabled,
  label = view.label,
  showContext = true,
}: {
  view: ShortcutCommandView;
  editor: Editor;
  platform: AppPlatform;
  disabled: boolean;
  label?: string | undefined;
  showContext?: boolean;
}) {
  const id = view.entry.id;
  return (
    <SettingsShortcutRow
      entry={view.entry}
      label={label}
      showContext={showContext}
      platform={platform}
      current={view.current}
      inactiveReason={view.inactiveReason}
      defaultKeys={view.defaultKeys}
      customized={view.customized}
      whenChoice={view.whenChoice}
      whenCustomized={view.whenCustomized}
      disabled={disabled}
      editor={rowEditorOf(editor, id)}
      note={editor.changeNote(id)}
      actions={editor.actions}
    />
  );
}

/** The ten position commands of one list, folded into one row until opened. */
function FamilyRows({
  family,
  editor,
  platform,
  disabled,
}: {
  family: ShortcutFamily;
  editor: Editor;
  platform: AppPlatform;
  disabled: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const editing = family.commands.some(
    (view) => view.entry.id === editor.recording || view.entry.id === editor.proposal?.id,
  );
  const expanded = opened || editing;
  const firstView = family.commands[0];
  const first = firstView?.current;
  const last = family.commands.at(-1)?.current;
  const assigned = family.commands.filter((view) => view.current).length;
  const lastKey = last && { ...last, mod: false, ctrl: false, alt: false, shift: false };
  const summary =
    first && last && assigned === family.commands.length
      ? `${spokenShortcut(first, platform)} to ${spokenShortcut(last, platform)}`
      : `${assigned} of ${family.commands.length} have keys`;
  return (
    <li className="list-none">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${family.label}, ${summary}`}
        aria-describedby={`shortcut-family-${family.key}`}
        onClick={() => setOpened(!expanded)}
        className="group/family flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{family.label}</span>
          <span
            id={`shortcut-family-${family.key}`}
            className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground"
          >
            When
            <span className="text-foreground/80">
              {firstView ? whenLabel(firstView.entry.scope, firstView.entry.when) : "Always"}
            </span>
            <span aria-hidden="true">·</span>
            {family.key === "session" ? "In sidebar order" : "In workspace rail order"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {first && lastKey && assigned === family.commands.length ? (
            <>
              <ShortcutKeycaps combination={first} platform={platform} />
              <span aria-hidden="true">to</span>
              <ShortcutKeycaps combination={lastKey} platform={platform} />
            </>
          ) : (
            summary
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "ml-1.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover/family:text-foreground motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-border border-t border-border bg-muted/30 [&>li]:min-h-12 [&>li]:py-2 [&>li]:pl-8">
          {family.commands.map((view) => (
            <CommandRow
              key={view.entry.id}
              view={view}
              editor={editor}
              platform={platform}
              disabled={disabled}
              label={positionRowLabel(view.entry.id)}
              showContext={false}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ShortcutListSkeleton() {
  return (
    <div role="status" aria-label="Loading shortcuts" className="flex flex-col gap-2">
      <Skeleton className="h-5 w-24" />
      <div className={ROW_LIST_CLASS_NAME}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-12 items-center justify-between gap-3 px-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
