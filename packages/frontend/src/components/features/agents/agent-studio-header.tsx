import { type ReactElement, type ReactNode, useCallback, useState } from "react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { OpenTaskDetailsButton } from "@/components/features/tasks/open-task-details-button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentStudioHeaderModel } from "./agent-studio-header.types";
import { QuickActionsMenu } from "./agent-studio-header-quick-actions";
import { canOpenQuickActionsMenu } from "./agent-studio-header-quick-actions-availability";
import { SessionHistoryMenu } from "./agent-studio-header-session-history";
import { WorkflowRail } from "./agent-studio-header-workflow-rail";

export type { AgentRoleOption, AgentStudioHeaderModel } from "./agent-studio-header.types";

type HeaderTitleProps = {
  taskTitle: string | null;
  taskId: string | null;
  onOpenTaskDetails: (() => void) | null;
};

function HeaderTitle({ taskTitle, taskId, onOpenTaskDetails }: HeaderTitleProps): ReactElement {
  const normalizedTaskTitle = taskTitle?.trim() ?? "";
  const hasTaskTitle = normalizedTaskTitle.length > 0;
  const normalizedTaskId = taskId?.trim() ?? "";
  const hasTaskId = normalizedTaskId.length > 0;
  const canOpenTaskDetails = hasTaskId && Boolean(onOpenTaskDetails);

  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <CardTitle
          className="truncate text-lg leading-6"
          title={hasTaskTitle ? normalizedTaskTitle : undefined}
        >
          {hasTaskTitle ? normalizedTaskTitle : "Task session"}
        </CardTitle>
      </div>
      {hasTaskId ? (
        <div className="flex items-center gap-1.5">
          <TaskIdBadge taskId={normalizedTaskId} />
          {canOpenTaskDetails ? (
            <OpenTaskDetailsButton onClick={() => onOpenTaskDetails?.()} />
          ) : null}
        </div>
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
  viewControls,
}: {
  model: AgentStudioHeaderModel;
  viewControls: ReactNode;
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
    <CardHeader className="electron-titlebar-safe-area border-b border-border bg-card py-3 px-4">
      <div className="flex items-start justify-between gap-2">
        <HeaderTitle
          taskTitle={model.taskTitle}
          taskId={model.taskId}
          onOpenTaskDetails={model.onOpenTaskDetails}
        />
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SessionHistoryMenu
            selector={model.sessionSelector}
            agentStudioReady={model.agentStudioReady}
          />
          <AgentStudioQuickActionsMenu
            key={quickActionsMenuStateKey}
            canOpenActionsMenu={canOpenActionsMenu}
            model={model}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="@container/workflow min-w-0 flex-1 overflow-x-auto px-1 py-1">
          <WorkflowRail
            steps={model.workflowSteps}
            selectedRole={model.selectedRole}
            agentStudioReady={model.agentStudioReady}
            onStepSelect={model.onWorkflowStepSelect}
          />
        </div>
        {viewControls}
      </div>
    </CardHeader>
  );
}
