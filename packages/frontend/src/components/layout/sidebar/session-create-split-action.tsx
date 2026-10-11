import { Archive, ChevronDown, Download, Import, MessageCirclePlus, Plus } from "lucide-react";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import {
  useWorkspaceDialogs,
  type WorkspaceDialogRequest,
} from "@/components/layout/workspace-dialogs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { cn } from "@/lib/utils";
import { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import {
  issueImportActionHint,
  issueImportActionLabel,
  issueImportBlockedReason,
  type IssueImportState,
  runIssueImport,
  toIssueImportState,
} from "@/pages/kanban/issue-import-provider";
import { isKanbanTaskCreationDisabled } from "@/pages/kanban/kanban-page-header-model";
import { useActiveWorkspace, useChecksState } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";

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
  importState,
  isTaskCreationDisabled,
  onOpenDialog,
  onOpenSettings,
}: {
  workspace: ActiveWorkspace;
  importState: IssueImportState;
  isTaskCreationDisabled: boolean;
  onOpenDialog: (dialog: WorkspaceDialogRequest) => void;
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
        label={issueImportActionLabel(importState)}
        title={issueImportActionHint(importState)}
        disabled={issueImportBlockedReason(importState) !== null || isTaskCreationDisabled}
        onSelect={() =>
          runIssueImport(importState, {
            openImport: (provider) => onOpenDialog({ kind: "import_tasks", workspace, provider }),
            openSettings: onOpenSettings,
          })
        }
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
  const { openWorkspaceDialog } = useWorkspaceDialogs();
  const { gitProvider } = useAgentStudioRepoSettings({
    activeWorkspaceId: workspace?.workspaceId ?? null,
    activeRepoPath: workspace?.repoPath ?? null,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const isTaskCreationDisabled = isKanbanTaskCreationDisabled(workspace, taskStoreCheck);
  const layout = SPLIT_LAYOUT[compact ? "compact" : "regular"];
  const mainLabel = workspace ? `New task in ${workspace.workspaceName}` : "New task";
  const menuLabel = workspace
    ? `More actions for ${workspace.workspaceName}`
    : "More create actions";

  const openDialog = (request: WorkspaceDialogRequest): void => {
    setMenuOpen(false);
    openWorkspaceDialog(request, menuTriggerRef.current);
  };

  return (
    <div className={layout.root}>
      {compact ? null : (
        <Button
          type="button"
          className="h-9 flex-1 justify-start gap-2 rounded-r-none px-3 shadow-none"
          aria-label={mainLabel}
          title={mainLabel}
          disabled={isTaskCreationDisabled}
          onClick={() => onCreateTask()}
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
                importState={toIssueImportState(gitProvider.context, gitProvider.error)}
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
  );
}
