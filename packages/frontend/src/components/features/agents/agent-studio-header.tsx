import { ArrowUpRightFromSquare } from "lucide-react";
import { type ReactElement, useState } from "react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentStudioHeaderModel } from "./agent-studio-header.types";
import { QuickActionsMenu } from "./agent-studio-header-quick-actions";
import { SessionHistoryMenu } from "./agent-studio-header-session-history";
import { WorkflowRail } from "./agent-studio-header-workflow-rail";

export type { AgentStudioHeaderModel } from "./agent-studio-header.types";
export { deriveSessionHistorySelectionFocusBehavior } from "./agent-studio-header-session-history";

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
          className="truncate text-xl"
          title={hasTaskTitle ? normalizedTaskTitle : undefined}
        >
          {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
        </CardTitle>
      </div>
      {hasTaskId ? (
        <div className="mt-1 flex items-center gap-1.5">
          <TaskIdBadge taskId={normalizedTaskId} />
          {canOpenTaskDetails ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto shrink-0 gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground transition hover:border-border hover:bg-muted hover:text-muted-foreground"
              title="Open task details"
              aria-label="Open task details"
              onClick={() => onOpenTaskDetails?.()}
            >
              <ArrowUpRightFromSquare className="size-3" />
              Open
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AgentStudioHeader({ model }: { model: AgentStudioHeaderModel }): ReactElement {
  const [isQuickActionsMenuOpen, setIsQuickActionsMenuOpen] = useState(false);

  return (
    <CardHeader className="border-b border-border bg-card pb-4">
      <div className="flex items-start justify-between gap-2">
        <HeaderTitle
          taskTitle={model.taskTitle}
          taskId={model.taskId}
          onOpenTaskDetails={model.onOpenTaskDetails}
        />
        <div className="flex shrink-0 items-stretch gap-2">
          <SessionHistoryMenu
            selector={model.sessionSelector}
            agentStudioReady={model.agentStudioReady}
          />
          <QuickActionsMenu
            isOpen={isQuickActionsMenuOpen}
            onOpenChange={setIsQuickActionsMenuOpen}
            agentStudioReady={model.agentStudioReady}
            isCreatingSession={model.isCreatingSession}
            options={model.quickActions}
            primaryAction={model.primaryQuickAction}
            sessionCreateOptions={model.sessionCreateOptions}
            onQuickAction={model.onQuickAction}
            onPrepareMessageFirstSession={model.onPrepareMessageFirstSession}
            onResolveGitConflictQuickAction={model.onResolveGitConflictQuickAction}
          />
        </div>
      </div>

      <WorkflowRail
        steps={model.workflowSteps}
        selectedRole={model.selectedRole}
        agentStudioReady={model.agentStudioReady}
        onStepSelect={model.onWorkflowStepSelect}
      />
    </CardHeader>
  );
}
