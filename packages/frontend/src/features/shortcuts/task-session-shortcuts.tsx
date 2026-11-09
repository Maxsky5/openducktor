import { workflowShortcutActionId } from "@openducktor/contracts";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { getQuickActionBlockedReason } from "@/components/features/agents/agent-studio-header-quick-actions-availability";
import { taskWorkflowInput, type ResolvedTaskCard } from "@openducktor/workflows";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentStudioHeaderModel } from "@/components/features/agents/agent-studio-header.types";
import { useRequiredTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { coreTaskActions } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { isAgentSessionActivityActive } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";

/** Use the record and actions already loaded by the visible task session. */
export function TaskSessionShortcuts({
  task,
  sessions,
  header,
}: {
  task: ResolvedTaskCard | null;
  sessions: readonly AgentSessionSummary[];
  header: Pick<
    AgentStudioHeaderModel,
    | "agentStudioReady"
    | "isCreatingSession"
    | "onResolveGitConflictQuickAction"
    | "quickActions"
    | "workflowSteps"
    | "onOpenTaskDetails"
    | "onQuickAction"
    | "onWorkflowStepSelect"
  >;
}): null {
  const active = useSessionViewActive();
  const workflow = useRequiredTaskWorkflowActions();
  const { copyToClipboard } = useCopyToClipboard({ successMessage: "Task ID copied" });
  const commands =
    task && active
      ? [
          { id: "task-edit" as const, run: () => workflow.onEdit(task.id) },
          {
            id: "task-details" as const,
            run: () => header.onOpenTaskDetails?.(),
          },
          {
            id: "task-copy-id" as const,
            run: () => {
              void copyToClipboard(task.id);
            },
          },
          {
            id: "task-delete" as const,
            run: () => workflow.onConfirmTaskAction(task.id, "delete"),
          },
          ...coreTaskActions(task).map((action) => ({
            id: action.id === "reset_task" ? ("task-reset" as const) : ("task-close" as const),
            label: action.label,
            run: () => workflow.onConfirmTaskAction(task.id, action.confirmation),
          })),
          ...task.taskWorkflow.definition.actions.flatMap((action) => {
            const role = task.taskWorkflow.viewActionRole(action.id);
            const launchId =
              action.kind === "session"
                ? task.taskWorkflow.evaluator.actionLaunchAction(taskWorkflowInput(task), action.id)
                : null;
            const option = header.quickActions.find((option) =>
              option.kind === "task_action"
                ? option.taskAction.kind === "workflow" && option.taskAction.action === action.id
                : launchId !== null && option.launchActionId === launchId,
            );

            const step = role
              ? header.workflowSteps.find(
                  (step) => step.role === role && step.sessionValue !== null,
                )
              : null;
            if (!option && !step) return [];
            return [
              {
                id: workflowShortcutActionId(task.taskWorkflow.definition.id, action.id),
                label: action.label ?? option?.label ?? "Open session",
                disabledReason: () =>
                  option
                    ? getQuickActionBlockedReason({
                        option,
                        agentStudioReady: header.agentStudioReady,
                        sessionStartBlockedReason: header.isCreatingSession
                          ? "Session start is already in progress."
                          : null,
                        onResolveGitConflictQuickAction: header.onResolveGitConflictQuickAction,
                      })
                    : !header.agentStudioReady
                      ? "The task session view is not ready."
                      : null,
                run: () => {
                  if (option) header.onQuickAction(option);
                  else if (step?.role) header.onWorkflowStepSelect(step.role, step.sessionValue);
                },
              },
            ];
          }),
          ...(sessions.length
            ? [
                {
                  id: "task-latest-session" as const,
                  run: () => {
                    const active = sessions.filter((session) =>
                      isAgentSessionActivityActive(session.activityState),
                    );
                    const latest = (active.length ? active : sessions).reduce((latest, session) =>
                      Date.parse(session.startedAt) > Date.parse(latest.startedAt)
                        ? session
                        : latest,
                    );
                    header.onWorkflowStepSelect(latest.role, agentSessionIdentityKey(latest));
                  },
                },
              ]
            : []),
        ]
      : [];
  useCommandPalettePageCommands(
    commands.map((command) => ({
      ...command,
      target: { kind: "task", key: task!.id },
    })),
  );
  return null;
}
