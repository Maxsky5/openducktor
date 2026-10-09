import { type ReactElement, type ReactNode, useCallback, useState } from "react";
import { ArrowUpRightFromSquare } from "lucide-react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionPageHeader } from "./session-page-header";
import type { AgentStudioHeaderModel } from "./agent-studio-header.types";
import { QuickActionsMenu } from "./agent-studio-header-quick-actions";
import { canOpenQuickActionsMenu } from "./agent-studio-header-quick-actions-availability";
import { SessionHistoryMenu } from "./agent-studio-header-session-history";

export type { AgentRoleOption, AgentStudioHeaderModel } from "./agent-studio-header.types";

type HeaderTitleProps = {
  taskTitle: string | null;
  taskId: string | null;
  onOpenTaskDetails: (() => void) | null;
};

function HeaderTitle({ taskTitle, taskId, onOpenTaskDetails }: HeaderTitleProps): ReactElement {
  const title = taskTitle?.trim() || "Task session";
  const id = taskId?.trim() || null;
  const canOpenTaskDetails = Boolean(id && onOpenTaskDetails);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="min-w-0 flex-1 text-sm font-semibold leading-5" aria-label={title}>
        {canOpenTaskDetails ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-1.5 h-7 w-full justify-start gap-1.5 px-1.5 text-sm font-semibold"
                aria-label="Open task details"
                onClick={() => onOpenTaskDetails?.()}
              >
                <span className="truncate">{title}</span>
                <ArrowUpRightFromSquare className="size-3 shrink-0 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-96">
              <p className="font-medium">{title}</p>
              <p className="text-xs opacity-75">Open task details · {id}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="block truncate">{title}</span>
        )}
      </h2>
      {id ? (
        <TaskIdBadge
          taskId={id}
          className="shrink-0 [&_button]:size-7 @max-[1000px]/session-header:[&>span]:hidden @max-[480px]/session-header:hidden"
        />
      ) : null}
    </div>
  );
}

function AgentStudioQuickActionsMenu({
  canOpenActionsMenu,
  model,
}: {
  canOpenActionsMenu: boolean;
  model: AgentStudioHeaderModel;
}): ReactElement {
  const [isQuickActionsMenuOpen, setIsQuickActionsMenuOpen] = useState(false);
  const effectiveQuickActionsMenuOpen = isQuickActionsMenuOpen && canOpenActionsMenu;

  const handleQuickActionsMenuOpenChange = useCallback(
    (isOpen: boolean): void => {
      setIsQuickActionsMenuOpen(isOpen && canOpenActionsMenu);
    },
    [canOpenActionsMenu],
  );

  return (
    <QuickActionsMenu
      canOpenActionsMenu={canOpenActionsMenu}
      isOpen={effectiveQuickActionsMenuOpen}
      onOpenChange={handleQuickActionsMenuOpenChange}
      agentStudioReady={model.agentStudioReady}
      isCreatingSession={model.isCreatingSession}
      options={model.quickActions}
      primaryAction={model.primaryQuickAction}
      sessionCreateOptions={model.sessionCreateOptions}
      onQuickAction={model.onQuickAction}
      onPrepareMessageFirstSession={model.onPrepareMessageFirstSession}
      onResolveGitConflictQuickAction={model.onResolveGitConflictQuickAction}
    />
  );
}

export function AgentStudioHeader({
  model,
  repoActions,
  viewControls,
  openIn,
}: {
  model: AgentStudioHeaderModel;
  repoActions: ReactNode;
  viewControls: ReactNode;
  openIn: ReactNode;
}): ReactElement {
  const canOpenActionsMenu = canOpenQuickActionsMenu({
    agentStudioReady: model.agentStudioReady,
    isCreatingSession: model.isCreatingSession,
    options: model.quickActions,
    primaryAction: model.primaryQuickAction,
    sessionCreateOptions: model.sessionCreateOptions,
    onResolveGitConflictQuickAction: model.onResolveGitConflictQuickAction,
  });
  const quickActionsMenuStateKey = canOpenActionsMenu
    ? "quick-actions-available"
    : "quick-actions-unavailable";

  return (
    <SessionPageHeader
      title={
        <HeaderTitle
          taskTitle={model.taskTitle}
          taskId={model.taskId}
          onOpenTaskDetails={model.onOpenTaskDetails}
        />
      }
      actions={
        <>
          {repoActions}
          <SessionHistoryMenu
            selector={model.sessionSelector}
            agentStudioReady={model.agentStudioReady}
          />
          <AgentStudioQuickActionsMenu
            key={quickActionsMenuStateKey}
            canOpenActionsMenu={canOpenActionsMenu}
            model={model}
          />
        </>
      }
      openIn={openIn}
      viewControls={viewControls}
    />
  );
}
