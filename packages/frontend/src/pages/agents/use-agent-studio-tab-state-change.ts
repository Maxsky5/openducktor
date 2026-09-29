import type { WorkspaceAgentStudioStateAction } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { host } from "@/state/operations/host";
import { applyWorkspaceAgentStudioStateAction } from "./agent-studio-state-writer";
import type { TaskTabState } from "./use-agent-studio-task-tabs-state";

type AgentStudioStateHost = Pick<typeof host, "workspaceApplyAgentStudioStateAction">;
type FailedChange = {
  workspaceId: string;
  action: WorkspaceAgentStudioStateAction;
  onSaved: () => void;
  error: Error;
};

export function useAgentStudioTabStateChange({
  workspaceId,
  hostClient = host,
}: {
  workspaceId: string | null;
  hostClient?: AgentStudioStateHost;
}) {
  const queryClient = useQueryClient();
  const [failures, setFailures] = useState<FailedChange[]>([]);
  const latestActions = useRef(new Map<string, WorkspaceAgentStudioStateAction>());

  const submit = useCallback(
    (
      targetWorkspaceId: string,
      action: WorkspaceAgentStudioStateAction,
      onSaved: () => void,
    ): Promise<void> => {
      return applyWorkspaceAgentStudioStateAction({
        queryClient,
        workspaceId: targetWorkspaceId,
        action,
        hostClient,
      }).then(
        () => {
          if (latestActions.current.get(targetWorkspaceId) === action) {
            onSaved();
            setFailures((current) =>
              current.filter((failure) => failure.workspaceId !== targetWorkspaceId),
            );
          }
        },
        (cause: unknown) => {
          if (latestActions.current.get(targetWorkspaceId) !== action) {
            return;
          }
          setFailures((current) => [
            ...current.filter((failure) => failure.workspaceId !== targetWorkspaceId),
            {
              workspaceId: targetWorkspaceId,
              action,
              onSaved,
              error: cause instanceof Error ? cause : new Error(String(cause)),
            },
          ]);
        },
      );
    },
    [hostClient, queryClient],
  );

  const onTabChange = useCallback(
    (
      baseOpenTaskIds: string[],
      nextState: TaskTabState,
      onSaved: () => void = () => {},
    ): Promise<void> | undefined => {
      if (!workspaceId) {
        return;
      }
      const action: WorkspaceAgentStudioStateAction = {
        type: "change_tabs",
        baseOpenTaskIds,
        openTaskIds: nextState.openTaskIds,
        activeTaskId: nextState.activeTaskId,
      };
      latestActions.current.set(workspaceId, action);
      setFailures((current) => current.filter((failure) => failure.workspaceId !== workspaceId));
      return submit(workspaceId, action, onSaved);
    },
    [submit, workspaceId],
  );

  const retry = useCallback((): void => {
    const failure = failures.find((entry) => entry.workspaceId === workspaceId);
    if (failure) {
      void submit(failure.workspaceId, failure.action, failure.onSaved);
    }
  }, [failures, submit, workspaceId]);

  return {
    onTabChange,
    saveError: failures.find((entry) => entry.workspaceId === workspaceId)?.error ?? null,
    retry,
  };
}
