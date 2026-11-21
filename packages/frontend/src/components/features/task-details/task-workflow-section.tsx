import type { WorkspaceRef } from "@openducktor/contracts";
import { agentSessionListQueryOptions } from "@openducktor/frontend-core/queries/agent-sessions";
import { workflowNameAndVersion } from "@openducktor/frontend-core/tasks/presentation/workflow-version-label";
import { useTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { useWorkspaceActivityProjection } from "@openducktor/frontend-core/workspace-activity/workspace-activity-context";
import { BUILTIN_WORKFLOW_ID, type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Workflow } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { Link } from "react-router";
import { WorkflowRail } from "@/components/features/agents/agent-studio-header-workflow-rail";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { taskRoleLane } from "@/features/session-navigation/session-preview-model";
import { workflowPath, workflowVersionPath } from "@/features/workflows/workflow-routes";

const SECTION_ICON = <Workflow className="size-3.5" />;

/**
 * The role lane of the task, as Agent Studio shows it: each workflow step with the live state of
 * its latest session. A step opens the session of its role.
 */
function RoleLane({ task, workspace }: { task: TaskCard; workspace: WorkspaceRef }): ReactElement {
  const workflowActions = useTaskWorkflowActions();
  const sessions = useQuery(agentSessionListQueryOptions(workspace, task.id));
  const projection = useWorkspaceActivityProjection(workspace.workspaceId);
  const { steps, roleTargets } = useMemo(
    () => taskRoleLane(task, sessions.data ?? [], workspace.workspaceId, projection),
    [task, sessions.data, workspace.workspaceId, projection],
  );
  return (
    <section aria-label="Role lane" className="@container/workflow -mx-1 overflow-x-auto px-1 pb-1">
      <WorkflowRail
        steps={steps}
        selectedStepId={null}
        disabled={workflowActions === null}
        onStepSelect={(stepId) => {
          const role = steps.find((entry) => entry.id === stepId)?.role;
          if (!role || !workflowActions) return;
          const target = roleTargets.get(role);
          workflowActions.onOpenSession(
            task.id,
            role,
            target?.kind === "task_session" ? { session: target.identity } : undefined,
          );
        }}
      />
    </section>
  );
}

/**
 * The workflow of a task: its name and version, and its role lane. View opens the version that the
 * task uses. The header badge of the sheet shows the state, so this section does not repeat it.
 */
export function TaskWorkflowSection({
  task,
  workspace,
}: {
  task: TaskCard;
  /** Null without a selected repository: the section then shows no role lane. */
  workspace: WorkspaceRef | null;
}): ReactElement {
  const { reference } = task.taskWorkflow;
  const href =
    reference.id === BUILTIN_WORKFLOW_ID
      ? workflowPath(reference.id)
      : workflowVersionPath(reference.id, reference.revision);
  return (
    <CollapsibleCard
      title="Workflow"
      icon={SECTION_ICON}
      summary={workflowNameAndVersion(task.taskWorkflow)}
      defaultExpanded
      headerAction={
        <Button asChild size="xs" variant="ghost" className="gap-1">
          <Link to={href} aria-label={`View the workflow ${task.taskWorkflow.definition.label}`}>
            View
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      {workspace ? <RoleLane task={task} workspace={workspace} /> : null}
    </CollapsibleCard>
  );
}
