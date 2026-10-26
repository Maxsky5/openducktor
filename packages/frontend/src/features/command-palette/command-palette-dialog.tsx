import type { AppPlatform, WorkspaceRecord } from "@openducktor/contracts";
import { type ReactElement, useRef, useState } from "react";
import { Command, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  useDialogPresence,
} from "@/components/ui/dialog";
import { useWorkspaceState } from "@/state/app-state-provider";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import type { PullRequestSyncTarget } from "@/types/pull-request-sync";
import {
  handlePaletteKeyDown,
  mainListEnterHint,
  paletteFooterHints,
  paletteKeyBindings,
  rowListEnterHint,
  scopeKeys,
} from "./command-palette-bindings";
import { CommandPaletteFooter } from "./command-palette-footer";
import { CommandPaletteInput } from "./command-palette-input";
import { CommandPaletteReply } from "./command-palette-reply";
import { MainResults, RowActionResults } from "./command-palette-results";
import { CommandPaletteScope, type PaletteScope, usePaletteScope } from "./command-palette-scope";
import type { CommandPalettePageCommand, CommandPaletteShell } from "./command-palette-types";
import { useCommandPaletteActions } from "./use-command-palette-actions";
import { type CommandPaletteData, useCommandPaletteData } from "./use-command-palette-data";
import { useCommandPaletteMainList } from "./use-command-palette-main-list";
import { highlightOf, useCommandPaletteNavigation } from "./use-command-palette-navigation";
import { usePaletteRowList } from "./use-command-palette-row-list";
import { useCommandPaletteRunners, usePaletteTaskViews } from "./use-command-palette-runners";
import type { WorkspaceIntent } from "./use-workspace-intent-runner";

type CommandPaletteDialogProps = {
  open: boolean;
  openPullRequestSync: (workspace: PullRequestSyncTarget | null) => void;
  platform: AppPlatform | null;
  shell: CommandPaletteShell;
  pageCommands: readonly CommandPalettePageCommand[];
  close: () => void;
  runAfterClose: (run: () => void) => void;
  runIntent: (intent: WorkspaceIntent) => void;
  previousFocus: () => HTMLElement | null;
  onCloseAutoFocus: (event: Event) => void;
};

/**
 * The palette unmounts on each close, so each open starts with an empty state. It reads its data
 * only while it is mounted.
 */
export function CommandPaletteDialog(props: CommandPaletteDialogProps): ReactElement | null {
  const mounted = useDialogPresence(props.open, "instant");
  return mounted ? <CommandPaletteBody {...props} /> : null;
}

/**
 * Reads the data of the scope. Key presses change only the state of the view below, so they do
 * not run these reads again.
 */
function CommandPaletteBody(props: CommandPaletteDialogProps): ReactElement {
  const { workspaces } = useWorkspaceState();
  const scope = usePaletteScope(workspaces);
  const data = useCommandPaletteData(scope.scopedWorkspaces);
  return <CommandPaletteView {...props} workspaces={workspaces} scope={scope} data={data} />;
}

function CommandPaletteView({
  open,
  platform,
  shell,
  pageCommands,
  close,
  runAfterClose,
  runIntent,
  previousFocus,
  openPullRequestSync,
  onCloseAutoFocus,
  workspaces,
  scope,
  data,
}: CommandPaletteDialogProps & {
  workspaces: readonly WorkspaceRecord[];
  scope: PaletteScope;
  data: CommandPaletteData;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const nav = useCommandPaletteNavigation(inputRef);
  const { actions, createFromQuery } = useCommandPaletteActions({
    scopeWorkspace: scope.workspace,
    openPullRequestSync,
    query: nav.query,
    shell,
    pageCommands,
    runIntent,
    previousFocus,
  });
  const taskViewOf = usePaletteTaskViews(data);
  const runners = useCommandPaletteRunners({
    close,
    runAfterClose,
    runIntent,
    taskViewOf,
    previousFocus,
  });
  const main = useCommandPaletteMainList({
    query: nav.query,
    isShown: nav.list.kind === "main",
    data,
    actions,
    createFromQuery,
  });
  const rowList = usePaletteRowList(nav.list, main, {
    query: nav.query,
    taskViewOf,
    runners,
    showReply: nav.showReply,
    sessionEntriesByKey: data.sessionEntriesByKey,
  });
  const highlight = highlightOf({
    highlighted: nav.highlighted,
    rowList,
    main,
    taskViewOf,
  });
  const rowListOpen = rowList !== null;

  const bindings = paletteKeyBindings({
    platform,
    rowListOpen,
    query: nav.query,
    back: nav.back,
    entry: highlight.entry,
    taskView: highlight.taskView,
    runTaskCommand: runners.runTaskCommand,
    renameChat: runners.renameChat,
    showActions: nav.showActions,
    caretAtEnd: () => isCaretAtEnd(inputRef.current),
    openScope: () => scope.setOpen(true),
  });
  const enter = rowList
    ? rowListEnterHint(rowList.actions.find((action) => action.key === highlight.value))
    : mainListEnterHint({
        entry: highlight.entry,
        taskView: highlight.taskView,
        createFromQuery,
        highlightedValue: highlight.value,
        openTask: runners.openTask,
        openChat: runners.openChat,
        runAction: runners.runAction,
      });
  const footer = paletteFooterHints({
    bindings,
    rowListOpen,
    back: nav.back,
    close,
  });
  const resultCount = highlight.enabledValues.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // The palette has no dialog trigger, so Radix only asks it to close.
        if (!nextOpen) close();
      }}
    >
      <DialogContent
        ref={setContent}
        // Users open the palette from a key many times a day, so motion would only delay them.
        motion="instant"
        // A light shade keeps the page in view, so the palette feels like part of it.
        overlayClassName="bg-black/20 backdrop-blur-none dark:bg-black/50"
        positionerClassName="items-start pt-[12vh] sm:items-start"
        // Dark shadows do not show on a dark page, so a lighter edge sets the palette apart.
        className="max-w-3xl gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl dark:border-foreground/15"
        closeButton={null}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          // Escape returns from a row action list or a reply. In the main list it closes the palette.
          if (nav.list.kind !== "main") {
            event.preventDefault();
            nav.back();
          }
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search actions, tasks, and chats in your workspaces.
        </DialogDescription>
        {nav.list.kind === "reply" ? (
          <CommandPaletteReply
            row={nav.list.entry}
            sessionEntries={(data.sessionEntriesByKey.get(nav.list.entry.item.key) ?? []).filter(
              waitsForReply,
            )}
            onBack={nav.back}
            onAllReplied={close}
          />
        ) : (
          <Command
            shouldFilter={false}
            loop
            label="Command palette"
            value={highlight.value}
            onValueChange={nav.highlightFromList}
            onKeyDown={(event) => {
              if (!scope.open && !event.nativeEvent.isComposing) {
                handlePaletteKeyDown(event, bindings);
              }
            }}
            className="rounded-none bg-popover"
          >
            <CommandPaletteInput
              inputRef={inputRef}
              query={nav.query}
              listRoot={content}
              highlight={highlight}
              highlightRequest={nav.highlightRequest}
              onQueryChange={nav.changeQuery}
              row={rowList?.entry ?? null}
              onBack={nav.back}
              isLoading={data.isLoading}
            >
              <CommandPaletteScope
                workspaces={workspaces}
                workspace={scope.workspace}
                open={scope.open}
                shortcutKeys={platform ? scopeKeys(platform) : null}
                portalContainer={content}
                onOpenChange={scope.setOpen}
                onChange={(workspaceId) => {
                  scope.setWorkspaceId(workspaceId);
                  nav.resetHighlight();
                  scope.setOpen(false);
                }}
                onCloseAutoFocus={(event) => {
                  // The list keeps focus in the input, also after a click in the scope list.
                  event.preventDefault();
                  inputRef.current?.focus();
                }}
              />
            </CommandPaletteInput>
            <CommandList className="max-h-[min(26rem,60vh)] scroll-py-2 p-2">
              {rowList ? (
                <RowActionResults list={rowList} query={nav.query} />
              ) : (
                <MainResults
                  groups={main.groups}
                  data={data}
                  query={nav.query}
                  showWorkspace={scope.workspace === null}
                  createFromQuery={createFromQuery}
                  onRunAction={runners.runAction}
                  onOpenTask={runners.openTask}
                  onShowActions={nav.showActions}
                  onOpenChat={runners.openChat}
                />
              )}
            </CommandList>
            <p className="sr-only" aria-live="polite">
              {resultCount === 1 ? "1 result" : `${resultCount} results`}
            </p>
            <CommandPaletteFooter
              enter={enter}
              itemHints={footer.itemHints}
              note={highlight.taskView?.sessionsNote ?? null}
              paletteHints={footer.paletteHints}
            />
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}

const isCaretAtEnd = (input: HTMLInputElement | null): boolean => {
  if (!input) return false;
  const end = input.value.length;
  return input.selectionStart === end && input.selectionEnd === end;
};

/** A sidebar entry with a question or a permission request that the palette can reply to. */
const waitsForReply = (entry: SessionNavigationEntry): boolean =>
  entry.attention.some((reason) => reason === "question" || reason === "permission");
