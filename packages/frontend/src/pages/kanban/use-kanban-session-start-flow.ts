import { useCallback } from "react";
import type { NavigateFunction } from "react-router";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import { showSessionStartMessageRecovery } from "@/features/session-start/session-start-message-recovery";
import {
  type OpenTaskView,
  type UseTaskSessionStartFlowResult,
  useTaskSessionStartFlow,
} from "@openducktor/frontend-core/tasks/workflow/use-task-session-start-flow";

type UseKanbanSessionStartFlowArgs = Omit<
  Parameters<typeof useTaskSessionStartFlow>[0],
  "openTaskView" | "onPostStartMessageFailure"
> & {
  navigate: NavigateFunction;
};

/** The task session start flow with desktop routes and the desktop first-message retry. */
export function useKanbanSessionStartFlow({
  navigate,
  ...args
}: UseKanbanSessionStartFlowArgs): UseTaskSessionStartFlowResult {
  const openTaskView = useCallback<OpenTaskView>(
    (target, selected) => {
      const href = buildSessionNavigationHref(target);
      if (!selected || target.kind !== "task_session") {
        navigate(href);
        return;
      }
      navigate(href, {
        state: {
          notificationTarget: {
            type: "agent_session",
            repoPath: selected.repoPath,
            taskId: target.taskId,
            session: target.identity,
          },
        },
      });
    },
    [navigate],
  );
  return useTaskSessionStartFlow({
    ...args,
    openTaskView,
    onPostStartMessageFailure: showSessionStartMessageRecovery,
  });
}
