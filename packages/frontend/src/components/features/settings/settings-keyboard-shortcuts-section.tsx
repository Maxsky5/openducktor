import { useMemo, useState } from "react";
import type { AppPlatform } from "@openducktor/contracts";
import { ChevronRight, RotateCcw, SearchX } from "lucide-react";
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
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShortcutShell } from "@/features/shortcuts/catalogue";
import { useShortcutCatalogue } from "@/features/shortcuts/use-shortcut-catalogue";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";
import { readDevicePlatform } from "@/lib/device-platform";
import { getShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import {
  buildCommandViews,
  countCommandViews,
  groupCommandViews,
  SHORTCUT_FILTERS,
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
  const editor = useShortcutEditor({ catalogue, platform, shell });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ShortcutFilter>("all");
  const [resetOpen, setResetOpen] = useState(false);
  const views = useMemo(
    () => buildCommandViews(catalogue, query.data, platform, shell),
    [catalogue, query.data, platform, shell],
  );
  const counts = useMemo(() => countCommandViews(views), [views]);
  const term = searchKey(search);
  const groups = useMemo(() => groupCommandViews(views, filter, term), [views, filter, term]);
  const browsingDisabled = editor.busy || editor.proposal !== null;

  return (
    <section aria-label="Keyboard shortcuts" className="flex flex-col pb-6">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-popover px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-semibold text-foreground">Keyboard shortcuts</h3>
            <p className="text-xs text-muted-foreground">
              Click a shortcut to change it. Shortcuts are saved on this host and shared by every
              app connected to it.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={browsingDisabled || !query.data}
            onClick={(event) => {
              editor.rememberOpener(event.currentTarget);
              setResetOpen(true);
            }}
          >
            <RotateCcw aria-hidden="true" /> Reset all
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1">
            <ToolbarSearchField
              id="shortcut-search"
              label="Search commands"
              placeholder="Search commands or keys…"
              size="md"
              value={search}
              disabled={browsingDisabled}
              onValueChange={setSearch}
            />
          </div>
          <SegmentedControlRoot aria-label="Show shortcuts" size="sm" className="rounded-lg">
            {SHORTCUT_FILTERS.map((option) => (
              <SegmentedControlItem
                key={option.value}
                size="sm"
                grow="hug"
                active={filter === option.value}
                disabled={browsingDisabled}
                onClick={() => setFilter(option.value)}
                className="gap-1.5"
              >
                {option.label}
                <span className="tabular-nums opacity-60">{counts[option.value]}</span>
              </SegmentedControlItem>
            ))}
          </SegmentedControlRoot>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <ShortcutNotices editor={editor} updatesError={updatesError} />
        {query.isPending ? (
          <ShortcutListSkeleton />
        ) : groups.size === 0 ? (
          <div
            role="status"
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-12 text-center"
          >
            <SearchX className="mb-1 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No shortcuts found</p>
            <p className="text-xs text-muted-foreground">
              Try another search, or show all shortcuts.
            </p>
          </div>
        ) : (
          Array.from(groups, ([group, items]) => (
            <section key={group} aria-label={group} className="flex flex-col gap-2">
              <h4 className="px-1 text-xs font-medium text-muted-foreground">{group}</h4>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
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
      ? { state: "recording", preparing: editor.preparing }
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
      disabled={editor.busy || (proposal !== null && proposal.id !== id) || !loaded}
      editor={rowEditor}
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
  return (
    <li className="list-none">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpened(!expanded)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left outline-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/40"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5 text-foreground">{family.label}</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            {family.key === "session" ? "Sessions in sidebar order" : "Workspaces in rail order"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 pr-[4.75rem] text-xs text-muted-foreground">
          {first && last && assigned === family.commands.length ? (
            <>
              <ShortcutKeycaps combination={first} platform={platform} />
              to
              <ShortcutKeycaps combination={last} platform={platform} />
            </>
          ) : (
            `${assigned} of ${family.commands.length} assigned`
          )}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-border/60 border-t border-border/60 bg-muted/20 [&>li]:pl-11">
          {family.commands.map((view, index) => (
            <CommandRow
              key={view.entry.id}
              view={view}
              editor={editor}
              platform={platform}
              loaded={loaded}
              label={`Position ${index + 1}`}
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
      <div className="divide-y divide-border/60 rounded-xl border border-border bg-card">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-h-12 items-center justify-between gap-3 px-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
