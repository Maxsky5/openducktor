import { useMemo, useRef, useState } from "react";
import type { AppPlatform } from "@openducktor/contracts";
import { ChevronDown, RotateCcw, SearchX } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShortcutShell } from "@/features/shortcuts/catalogue";
import { spokenShortcut } from "@openducktor/frontend-core/shortcuts/key-labels";
import { useShortcutCatalogue } from "@/features/shortcuts/use-shortcut-catalogue";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";
import { readDevicePlatform } from "@/lib/device-platform";
import { getShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import {
  buildCommandViews,
  countCommandViews,
  groupCommandViews,
  type ShortcutCommandView,
  type ShortcutFamily,
  type ShortcutFilter,
  searchKey,
} from "./settings-shortcut-model";
import {
  SettingsShortcutRow,
  ShortcutKeycaps,
  type ShortcutRowEditor,
} from "./settings-shortcut-row";
import { useShortcutEditor } from "./use-shortcut-editor";

type Editor = ReturnType<typeof useShortcutEditor>;

export function SettingsKeyboardShortcutsSection() {
  const { query, updatesError } = useShortcutPreferences();
  const catalogue = useShortcutCatalogue(query.data);
  const platform = readDevicePlatform();
  const shell: ShortcutShell =
    getShellBridge().browser.surface === "electron" ? "electron" : "browser";
  const heading = useRef<HTMLHeadingElement>(null);
  const editor = useShortcutEditor({ catalogue, platform, shell, heading });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ShortcutFilter>("in-use");
  const [resetOpen, setResetOpen] = useState(false);
  const views = useMemo(
    () => buildCommandViews(catalogue, query.data, platform, shell),
    [catalogue, query.data, platform, shell],
  );
  const counts = useMemo(() => countCommandViews(views), [views]);
  const term = searchKey(search);
  const { removedId, forgetRemoval } = editor;
  const groups = useMemo(
    () => groupCommandViews(views, filter, term, removedId),
    [views, filter, term, removedId],
  );
  const browsingDisabled = editor.busy || editor.proposal !== null;

  return (
    <section aria-label="Keyboard shortcuts" className="grid gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h3
            ref={heading}
            tabIndex={-1}
            className="text-sm font-semibold text-foreground outline-none"
          >
            Keyboard shortcuts
          </h3>
          <p className="text-xs text-muted-foreground">
            Click keys to change them. Changes apply to every app connected to this host.
          </p>
        </div>
        {counts.changed > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={browsingDisabled}
            onClick={(event) => {
              editor.rememberOpener(event.currentTarget);
              setResetOpen(true);
            }}
          >
            <RotateCcw aria-hidden="true" /> Reset all
          </Button>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {editor.announcement}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <ToolbarSearchField
            id="shortcut-search"
            label="Search commands"
            placeholder={`Search all commands or keys, such as ${platform === "darwin" ? "⌘K" : "Ctrl+K"}`}
            size="md"
            value={search}
            disabled={browsingDisabled}
            onValueChange={(value) => {
              forgetRemoval();
              setSearch(value);
            }}
          />
        </div>
        {term ? (
          <span className="text-xs text-muted-foreground">Searching all {counts.all} commands</span>
        ) : (
          <RadioGroup
            aria-label="Show"
            orientation="horizontal"
            data-variant="segmented"
            className="flex h-8 w-auto shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
            value={filter}
            disabled={browsingDisabled}
            onValueChange={(value) => {
              if (value !== "in-use" && value !== "all") return;
              forgetRemoval();
              setFilter(value);
            }}
          >
            <RadioGroupSegmentItem value="in-use" className="h-7 gap-1.5 px-2.5 whitespace-nowrap">
              With keys <span className="font-normal tabular-nums">{counts["in-use"]}</span>
            </RadioGroupSegmentItem>
            <RadioGroupSegmentItem value="all" className="h-7 gap-1.5 px-2.5 whitespace-nowrap">
              All <span className="font-normal tabular-nums">{counts.all}</span>
            </RadioGroupSegmentItem>
          </RadioGroup>
        )}
      </div>

      <div className="grid gap-5">
        <ShortcutNotices editor={editor} updatesError={updatesError} />
        {query.isPending ? (
          <ShortcutListSkeleton />
        ) : groups.size === 0 ? (
          <div
            role="status"
            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-center"
          >
            <SearchX className="mb-1 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">{term ? "No match" : "No shortcuts"}</p>
            <p className="text-xs text-muted-foreground">
              Try another search, or show all shortcuts.
            </p>
          </div>
        ) : (
          Array.from(groups, ([group, items]) => (
            <section key={group} aria-label={group} className="grid gap-2">
              <h4 className="text-xs font-medium text-muted-foreground">{group}</h4>
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                {items.map((item) =>
                  item.kind === "command" ? (
                    <CommandRow
                      key={item.command.entry.id}
                      view={item.command}
                      editor={editor}
                      platform={platform}
                      loaded={Boolean(query.data)}
                    />
                  ) : (
                    <FamilyRows
                      key={item.family.key}
                      family={item.family}
                      editor={editor}
                      platform={platform}
                      loaded={Boolean(query.data)}
                    />
                  ),
                )}
              </ul>
            </section>
          ))
        )}
        {!term && filter === "in-use" && counts.all > counts["in-use"] && !query.isPending && (
          <button
            type="button"
            disabled={browsingDisabled}
            onClick={() => {
              forgetRemoval();
              setFilter("all");
            }}
            className="justify-self-start rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {counts.all - counts["in-use"]} more commands have no keys. Show all
          </button>
        )}
      </div>

      <ResetShortcutsDialog
        open={resetOpen}
        saving={editor.saving}
        onOpenChange={setResetOpen}
        onReset={async () => {
          if (await editor.resetAll()) setResetOpen(false);
        }}
        onClosed={editor.focusOpener}
      />
    </section>
  );
}

function ShortcutNotices({
  editor,
  updatesError,
}: {
  editor: Editor;
  updatesError: string | null;
}) {
  const { query } = useShortcutPreferences();
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
          <Button
            variant="outline"
            size="sm"
            disabled={editor.busy}
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </Alert>
      )}
      {editor.saveError && (
        <Alert variant="destructive" className="items-center justify-between gap-3">
          <p>{editor.saveError}</p>
          {editor.proposal?.problem === null && (
            <Button
              variant="outline"
              size="sm"
              disabled={editor.busy}
              onClick={editor.saveProposal}
            >
              Retry save
            </Button>
          )}
        </Alert>
      )}
    </>
  );
}

function CommandRow({
  view,
  editor,
  platform,
  loaded,
  label = view.label,
  showContext = true,
}: {
  view: ShortcutCommandView;
  editor: Editor;
  platform: AppPlatform;
  loaded: boolean;
  label?: string;
  showContext?: boolean;
}) {
  const id = view.entry.id;
  const { proposal } = editor;
  const rowEditor: ShortcutRowEditor | null =
    editor.recording === id
      ? {
          state: "recording",
          preparing: editor.preparing,
          held: editor.held,
          ignored: editor.ignored,
        }
      : proposal?.id === id
        ? { state: "proposed", ...proposal, saving: editor.saving }
        : null;
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
      disabled={
        (editor.busy && editor.recording !== id && proposal?.id !== id) ||
        (proposal !== null && proposal.id !== id) ||
        !loaded
      }
      editor={rowEditor}
      saved={editor.savedId === id}
      removed={editor.removedId === id}
      onUndo={editor.undoRemoval}
      onRecord={(element) => editor.record(id, element)}
      onClear={(element) => editor.assign(id, null, element)}
      onRestoreDefault={(element) => editor.assign(id, view.defaultKeys, element)}
      onCancel={editor.cancel}
      onSave={editor.saveProposal}
      onReassign={editor.reassign}
    />
  );
}

/** The ten position commands of one list, folded into one row until opened. */
function FamilyRows({
  family,
  editor,
  platform,
  loaded,
}: {
  family: ShortcutFamily;
  editor: Editor;
  platform: AppPlatform;
  loaded: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const editing = family.commands.some(
    (view) => view.entry.id === editor.recording || view.entry.id === editor.proposal?.id,
  );
  const expanded = opened || editing;
  const first = family.commands[0]?.current;
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
        className="group/family flex min-h-10 w-full items-center gap-3 px-4 py-1.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-expanded:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-foreground">{family.label}</span>
          <span
            id={`shortcut-family-${family.key}`}
            className="block text-xs text-muted-foreground"
          >
            {family.key === "session" ? "In sidebar order" : "In workspace rail order"}
          </span>
        </span>
        <span className="flex h-7 shrink-0 items-center gap-1 px-1 text-xs text-muted-foreground">
          {first && lastKey && assigned === family.commands.length ? (
            <>
              <ShortcutKeycaps combination={first} platform={platform} />
              <span aria-hidden="true">–</span>
              <ShortcutKeycaps combination={lastKey} platform={platform} />
            </>
          ) : (
            summary
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "ml-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/family:text-foreground motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-border/50 border-t border-border/50 bg-muted/20 [&>li]:min-h-9 [&>li]:py-1 [&>li]:pl-8">
          {family.commands.map((view, index) => (
            <CommandRow
              key={view.entry.id}
              view={view}
              editor={editor}
              platform={platform}
              loaded={loaded}
              label={`${family.key === "session" ? "Session" : "Workspace"} ${index + 1}`}
              showContext={false}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ResetShortcutsDialog({
  open,
  saving,
  onOpenChange,
  onReset,
  onClosed,
}: {
  open: boolean;
  saving: boolean;
  onOpenChange(open: boolean): void;
  onReset(): void;
  onClosed(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>Reset all shortcuts?</DialogTitle>
          <DialogDescription>
            This removes every custom and removed shortcut on this host, and restores the defaults
            for everyone connected to it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={saving} onClick={onReset}>
            {saving ? "Resetting…" : "Reset all shortcuts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutListSkeleton() {
  return (
    <div role="status" aria-label="Loading shortcuts" className="flex flex-col gap-2">
      <Skeleton className="h-4 w-16" />
      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-12 items-center justify-between gap-3 px-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
