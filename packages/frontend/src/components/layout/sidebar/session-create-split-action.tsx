import type { RepositoryGitProviderContext, WorkspaceSession } from "@openducktor/contracts";
import { Archive, ChevronDown, Download, Import, MessageCirclePlus, Plus } from "lucide-react";
import { lazy, type ReactElement, type ReactNode, Suspense, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildSessionNavigationHref } from "@/features/session-navigation/session-navigation-target";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import {
  type IssueImportProvider,
  issueImportProvider,
  issueImportSourceLabel,
} from "@/pages/kanban/issue-import-provider";
import { isKanbanTaskCreationDisabled } from "@/pages/kanban/kanban-page-header-model";
import { useTaskControlContext } from "@/state/app-state-contexts";
import { useActiveWorkspace, useChecksState } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";

const WorkspaceSessionCreateDialog = lazy(() =>
  import("@/pages/workspace-sessions/workspace-session-create-dialog").then((module) => ({
    default: module.WorkspaceSessionCreateDialog,
  })),
);
const WorkspaceSessionHistoryDialog = lazy(() =>
  import("@/pages/workspace-sessions/workspace-session-history-dialog").then((module) => ({
    default: module.WorkspaceSessionHistoryDialog,
  })),
);
const WorkspaceSessionImportDialog = lazy(() =>
  import("@/pages/workspace-sessions/workspace-session-import-dialog").then((module) => ({
    default: module.WorkspaceSessionImportDialog,
  })),
);
const IssueImportDialog = lazy(() =>
  import("@/pages/kanban/issue-import-dialog").then((module) => ({
    default: module.IssueImportDialog,
  })),
);

/** A dialog keeps the workspace that was active when it opened, so a submission never moves. */
type OpenDialog =
  | { kind: "chat"; workspace: ActiveWorkspace }
  | { kind: "archived_chats"; workspace: ActiveWorkspace }
  | { kind: "import_chat"; workspace: ActiveWorkspace }
  | { kind: "import_tasks"; workspace: ActiveWorkspace; provider: IssueImportProvider };

/** The create chat dialog stays mounted while it closes, so it keeps its own request. */
type ChatDialogRequest = { workspace: ActiveWorkspace; attempt: number };

const SPLIT_LAYOUT = {
  regular: {
    root: "flex w-full",
    menu: "h-9 px-2.5",
    align: "end",
    side: "bottom",
  },
  compact: {
    root: "flex w-full justify-center",
    menu: "size-9 min-w-0 px-0",
    align: "start",
    side: "right",
  },
} as const;

type ProviderImport =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; provider: IssueImportProvider };

const providerImport = (
  provider: RepositoryGitProviderContext | undefined,
  providerError: Error | null,
): ProviderImport => {
  if (providerError) return { kind: "unavailable", reason: providerError.message };
  if (provider === undefined) return { kind: "loading" };
  const importProvider = issueImportProvider(provider);
  return importProvider
    ? { kind: "ready", provider: importProvider }
    : { kind: "unavailable", reason: "Set up a Git provider with issue access in Settings." };
};

const providerImportLabel = (tasksImport: ProviderImport): string =>
  tasksImport.kind === "ready"
    ? `Import tasks from ${issueImportSourceLabel(tasksImport.provider.config.id)}`
    : "Import tasks from the Git provider";

const providerImportTitle = (tasksImport: ProviderImport): string | undefined => {
  if (tasksImport.kind === "loading") return "Loading the Git provider…";
  if (tasksImport.kind === "unavailable") return tasksImport.reason;
  return undefined;
};

function MenuItem({
  icon,
  label,
  title,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  title?: string | undefined;
  disabled?: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto min-h-8 w-full justify-start gap-2 whitespace-normal px-2.5 py-1.5 text-left font-normal"
      disabled={disabled}
      title={title}
      aria-description={title}
      onClick={onSelect}
    >
      <span className="shrink-0 [&_svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 text-sm">{label}</span>
    </Button>
  );
}

function SessionCreateMenuItems({
  workspace,
  tasksImport,
  isTaskCreationDisabled,
  onOpenDialog,
  onOpenSettings,
}: {
  workspace: ActiveWorkspace;
  tasksImport: ProviderImport;
  isTaskCreationDisabled: boolean;
  onOpenDialog: (dialog: OpenDialog) => void;
  onOpenSettings: () => void;
}): ReactElement {
  return (
    <>
      <MenuItem
        icon={<MessageCirclePlus />}
        label="New chat"
        onSelect={() => onOpenDialog({ kind: "chat", workspace })}
      />
      <MenuItem
        icon={<Download />}
        label={providerImportLabel(tasksImport)}
        title={providerImportTitle(tasksImport)}
        disabled={tasksImport.kind === "loading" || isTaskCreationDisabled}
        onSelect={() => {
          if (tasksImport.kind === "ready") {
            onOpenDialog({ kind: "import_tasks", workspace, provider: tasksImport.provider });
          } else {
            onOpenSettings();
          }
        }}
      />
      <MenuItem
        icon={<Archive />}
        label="Archived chats"
        onSelect={() => onOpenDialog({ kind: "archived_chats", workspace })}
      />
      <MenuItem
        icon={<Import />}
        label="Import chat from an external runtime"
        onSelect={() => onOpenDialog({ kind: "import_chat", workspace })}
      />
    </>
  );
}

function SessionCreateDialogs({
  dialog,
  chatDialog,
  onClose,
  onOpenSession,
  onCloseAutoFocus,
}: {
  dialog: OpenDialog | null;
  chatDialog: ChatDialogRequest | null;
  onClose: () => void;
  onOpenSession: (workspace: ActiveWorkspace, record: WorkspaceSession) => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const { refreshTaskData } = useTaskControlContext();
  const chatDialogOpen = dialog?.kind === "chat";
  const chatDialogMounted = useDialogPresence(chatDialogOpen);
  return (
    <Suspense fallback={null}>
      {chatDialogMounted && chatDialog ? (
        <WorkspaceSessionCreateDialog
          key={`${chatDialog.workspace.workspaceId}-${chatDialog.attempt}`}
          open={chatDialogOpen}
          workspace={chatDialog.workspace}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
          onCreated={(record) => onOpenSession(chatDialog.workspace, record)}
        />
      ) : null}
      {dialog?.kind === "archived_chats" ? (
        <WorkspaceSessionHistoryDialog
          workspaceId={dialog.workspace.workspaceId}
          repoPath={dialog.workspace.repoPath}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
      {dialog?.kind === "import_chat" ? (
        <WorkspaceSessionImportDialog
          workspaceId={dialog.workspace.workspaceId}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
          onImported={(record) => onOpenSession(dialog.workspace, record)}
        />
      ) : null}
      {dialog?.kind === "import_tasks" ? (
        <IssueImportDialog
          key={dialog.workspace.workspaceId}
          open
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          repoPath={dialog.workspace.repoPath}
          provider={dialog.provider}
          onImported={() => {
            void refreshTaskData(dialog.workspace.repoPath).catch((cause: unknown) => {
              toast.error("Tasks were imported, but the task list did not refresh.", {
                description: `${errorMessage(cause)} Refresh the Kanban board to see them.`,
              });
            });
          }}
        />
      ) : null}
    </Suspense>
  );
}

/**
 * Expanded mode keeps New task as the main action. Compact mode puts it in the menu.
 *
 * Every action targets the active workspace, also while the list shows all workspaces.
 */
export function SessionCreateSplitAction({ compact = false }: { compact?: boolean }): ReactElement {
  const workspace = useActiveWorkspace();
  const { taskStoreCheck } = useChecksState();
  const { onCreateTask } = useRequiredTaskWorkflowActions();
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const { gitProvider } = useAgentStudioRepoSettings({
    activeWorkspaceId: workspace?.workspaceId ?? null,
    activeRepoPath: workspace?.repoPath ?? null,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [chatDialog, setChatDialog] = useState<ChatDialogRequest | null>(null);
  const chatAttemptRef = useRef(0);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const isTaskCreationDisabled = isKanbanTaskCreationDisabled(workspace, taskStoreCheck.data);
  const layout = SPLIT_LAYOUT[compact ? "compact" : "regular"];
  const mainLabel = workspace ? `New task in ${workspace.workspaceName}` : "New task";
  const menuLabel = workspace
    ? `More actions for ${workspace.workspaceName}`
    : "More create actions";

  const openDialog = (next: OpenDialog): void => {
    setMenuOpen(false);
    if (next.kind === "chat") {
      chatAttemptRef.current += 1;
      setChatDialog({ workspace: next.workspace, attempt: chatAttemptRef.current });
    }
    setDialog(next);
  };
  // The chat is saved before this runs, so a cancelled transition only skips opening it.
  const openSessionAfterSave = (target: ActiveWorkspace, record: WorkspaceSession): void => {
    setDialog(null);
    const href = buildSessionNavigationHref({
      kind: "workspace_session",
      workspaceId: target.workspaceId,
      sessionId: record.id,
    });
    guardTransition(() => {
      void navigate(href);
    });
  };

  return (
    <>
      <div className={layout.root}>
        {compact ? null : (
          <Button
            type="button"
            className="h-9 flex-1 justify-start gap-2 rounded-r-none px-3 shadow-none"
            aria-label={mainLabel}
            title={mainLabel}
            disabled={isTaskCreationDisabled}
            onClick={onCreateTask}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            New task
          </Button>
        )}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              ref={menuTriggerRef}
              type="button"
              className={cn(
                "shadow-none",
                !compact && "rounded-l-none border-l border-primary-foreground/25",
                layout.menu,
              )}
              aria-label={menuLabel}
              title={menuLabel}
              disabled={!workspace}
            >
              {compact ? <Plus aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align={layout.align} side={layout.side} className="w-72 p-1.5">
            {workspace ? (
              <>
                {compact ? (
                  <MenuItem
                    icon={<Plus />}
                    label="New task"
                    disabled={isTaskCreationDisabled}
                    onSelect={() => {
                      setMenuOpen(false);
                      // The menu item unmounts before the task dialog restores focus.
                      menuTriggerRef.current?.focus();
                      onCreateTask();
                    }}
                  />
                ) : null}
                <SessionCreateMenuItems
                  workspace={workspace}
                  tasksImport={providerImport(gitProvider.context, gitProvider.error)}
                  isTaskCreationDisabled={isTaskCreationDisabled}
                  onOpenDialog={openDialog}
                  onOpenSettings={() => {
                    setMenuOpen(false);
                    openSettings();
                  }}
                />
              </>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
      <SessionCreateDialogs
        dialog={dialog}
        chatDialog={chatDialog}
        onClose={() => setDialog(null)}
        onOpenSession={openSessionAfterSave}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Settings can open from an import dialog. Keep focus in that new dialog.
          if (!document.activeElement?.closest('[role="dialog"][data-state="open"]'))
            menuTriggerRef.current?.focus();
        }}
      />
    </>
  );
}
