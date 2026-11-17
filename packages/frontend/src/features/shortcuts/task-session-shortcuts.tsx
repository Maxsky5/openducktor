import { memo, useMemo } from "react";
import { workflowShortcutActionId } from "@openducktor/contracts";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { getQuickActionBlockedReason } from "@/components/features/agents/agent-studio-header-quick-actions-availability";
import type { ResolvedTaskCard } from "@openducktor/workflows";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentStudioHeaderModel } from "@/components/features/agents/agent-studio-header.types";
import { useRequiredTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { coreTaskActions } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { resolveLatestTaskSession } from "@openducktor/frontend-core/lib/agent-session-options";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
import { coreTaskActionShortcutId } from "./catalogue";

/**
 * Use the record and actions already loaded by the visible task session. Memoized: the session
 * shell renders on every streamed update, and these commands change only with their inputs.
 */
export const TaskSessionShortcuts = memo(function TaskSessionShortcuts({
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
  const {
    agentStudioReady,
    isCreatingSession,
    onResolveGitConflictQuickAction,
    quickActions,
    workflowSteps,
    onOpenTaskDetails,
    onQuickAction,
    onWorkflowStepSelect,
  } = header;
  const commands = useMemo(() => {
    if (!task || !active) return [];
    const list = [
      { id: "task-edit" as const, run: () => workflow.onEdit(task.id) },
      {
        id: "task-details" as const,
        run: () => onOpenTaskDetails?.(),
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
        id: coreTaskActionShortcutId(action.id),
        label: action.label,
        run: () => workflow.onConfirmTaskAction(task.id, action.confirmation),
      })),
      ...task.taskWorkflow.definition.actions.flatMap((action) => {
        const role = task.taskWorkflow.viewActionRole(action.id);
        const launchId =
          action.kind === "session" ? task.taskWorkflow.actionLaunchAction(task, action.id) : null;
        const option = quickActions.find((option) =>
          option.kind === "task_action"
            ? option.taskAction.kind === "workflow" && option.taskAction.action === action.id
            : launchId !== null && option.launchActionId === launchId,
        );

        const step = role
          ? workflowSteps.find((step) => step.role === role && step.sessionValue !== null)
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
                    agentStudioReady: agentStudioReady,
                    sessionStartBlockedReason: isCreatingSession
                      ? "Session start is already in progress."
                      : null,
                    onResolveGitConflictQuickAction: onResolveGitConflictQuickAction,
                  })
                : !agentStudioReady
                  ? "The task session view is not ready."
                  : null,
            run: () => {
              if (option) onQuickAction(option);
              else if (step?.role) onWorkflowStepSelect(step.role, step.sessionValue);
            },
          },
        ];
      }),
      ...(sessions.length
        ? [
            {
              id: "task-latest-session" as const,
              run: () => {
                const latest = resolveLatestTaskSession(sessions, sessions);
                if (latest) onWorkflowStepSelect(latest.role, agentSessionIdentityKey(latest));
              },
            },
          ]
        : []),
    ];
    return list.map((command) => ({ ...command, target: { kind: "task" as const, key: task.id } }));
  }, [
    task,
    active,
    sessions,
    workflow,
    copyToClipboard,
    agentStudioReady,
    isCreatingSession,
    onResolveGitConflictQuickAction,
    quickActions,
    workflowSteps,
    onOpenTaskDetails,
    onQuickAction,
    onWorkflowStepSelect,
  ]);
  useCommandPalettePageCommands(commands);
  return null;
});
