import { useCallback } from "react";
import type { NavigateFunction } from "react-router";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import {
  type OpenTaskView,
  type UseTaskSessionStartFlowResult,
  useTaskSessionStartFlow,
} from "@openducktor/frontend-core/tasks/workflow/use-task-session-start-flow";

type UseKanbanSessionStartFlowArgs = Omit<
  Parameters<typeof useTaskSessionStartFlow>[0],
  "openTaskView"
> & {
  navigate: NavigateFunction;
  closeTaskDetails: (taskId: string) => void;
};

/** The task session start flow with desktop routes. */
export function useKanbanSessionStartFlow({
  navigate,
  closeTaskDetails,
  ...args
}: UseKanbanSessionStartFlowArgs): UseTaskSessionStartFlowResult {
  const openTaskView = useCallback<OpenTaskView>(
    (target, selected) => {
      // The task view replaces the current view, so the task details must not stay over it.
      closeTaskDetails(target.taskId);
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
    [closeTaskDetails, navigate],
  );
  return useTaskSessionStartFlow({
    ...args,
    openTaskView,
  });
}
