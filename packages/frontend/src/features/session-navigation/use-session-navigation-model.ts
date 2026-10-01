import type {
  AgentSessionMetadata,
  AgentSessionRecord,
  SidebarSessionGrouping,
  TaskCard,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { LoadAgentSessionMetadataInput } from "@openducktor/core";
import { type QueryObserverResult, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import {
  buildSessionNavigationModel,
  type SessionNavigationModel,
  type SessionNavigationRead,
  type SessionNavigationSourceIssue,
  type SessionNavigationWorkspace,
} from "@/state/read-models/session-navigation-read-model";
import { agentSessionMetadataQueryOptions } from "@/state/queries/agent-session-metadata";
import {
  normalizeAgentSessionTaskIds,
  retryAgentSessionListQueries,
} from "@/state/queries/agent-sessions";
import {
  type AgentSessionListRead,
  type AgentSessionListTarget,
  agentSessionListTargetKey,
  useAgentSessionListQueries,
} from "@/state/queries/use-agent-session-lists";
import { repoTaskDataQueryOptions, taskQueryKeys } from "@/state/queries/tasks";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "@/state/queries/workspace-sessions";
import { useWorkspaceSessionLiveSnapshot } from "@/state/workspace-activity/workspace-activity-context";

export type SessionNavigationModelResult = {
  model: SessionNavigationModel;
  /** Read a failed source again. Live status recovers through its own stream. */
  retrySource: (issue: SessionNavigationSourceIssue) => void;
};

/**
 * Share query keys with the open conversation and keep scoped workspace observers mounted,
 * so live updates reach the sidebar without a page change.
 */
export function useSessionNavigationModel(
  workspaces: readonly SessionNavigationWorkspace[],
  grouping: SidebarSessionGrouping,
): SessionNavigationModelResult {
  const queryClient = useQueryClient();

  const taskReads = useQueries({
    queries: workspaces.map((workspace) => repoTaskDataQueryOptions(workspace.repoPath)),
    combine: combineTaskReads,
  });

  const workspaceSessionReads = useQueries({
    queries: workspaces.map((workspace) => workspaceSessionListQueryOptions(workspace.workspaceId)),
    combine: toReads<WorkspaceSession[]>,
  });

  const listTargets = useMemo(
    () =>
      workspaces.flatMap((workspace, index) => {
        const read = taskReads[index];
        if (read?.status !== "ready") return [];
        return normalizeAgentSessionTaskIds(read.data.map((task) => task.id)).map((taskId) => ({
          repoPath: workspace.repoPath,
          taskId,
        }));
      }),
    [taskReads, workspaces],
  );

  const listReadByKey = useAgentSessionListQueries({
    targets: listTargets,
    enabled: true,
    queryClient,
    combine: combineTaskSessionReads,
  });

  const metadataTargets = useMemo(
    () =>
      workspaces.flatMap((workspace, index) => {
        const read = taskReads[index];
        if (read?.status !== "ready") return [];
        return read.data.flatMap((task) => {
          const list = listReadByKey.get(
            agentSessionListTargetKey({ repoPath: workspace.repoPath, taskId: task.id }),
          );
          if (list?.status !== "ready") return [];
          return list.data.map((record): MetadataTarget => ({
            workspaceId: workspace.workspaceId,
            input: {
              repoPath: workspace.repoPath,
              runtimeKind: record.runtimeKind,
              workingDirectory: record.workingDirectory,
              externalSessionId: record.externalSessionId,
              sessionScope: { kind: "workflow", taskId: task.id, role: record.role },
            },
          }));
        });
      }),
    [listReadByKey, taskReads, workspaces],
  );
  const metadataReads = useQueries({
    queries: metadataTargets.map((target) => agentSessionMetadataQueryOptions(target.input)),
    combine: toReads<AgentSessionMetadata>,
  });

  const live = useWorkspaceSessionLiveSnapshot();

  const model = useMemo(() => {
    const metadataByWorkspaceId = new Map<
      string,
      Map<string, SessionNavigationRead<AgentSessionMetadata>>
    >();
    metadataTargets.forEach((target, index) => {
      const read = metadataReads[index];
      if (!read) return;
      const reads = metadataByWorkspaceId.get(target.workspaceId) ?? new Map();
      reads.set(agentSessionIdentityKey(target.input), read);
      metadataByWorkspaceId.set(target.workspaceId, reads);
    });
    return buildSessionNavigationModel(
      workspaces.map((workspace, index) => {
        const tasks = taskReads[index] ?? { status: "loading" };
        const taskSessions = new Map<string, SessionNavigationRead<AgentSessionRecord[]>>(
          tasks.status === "ready"
            ? tasks.data.map((task) => [
                task.id,
                listReadByKey.get(
                  agentSessionListTargetKey({ repoPath: workspace.repoPath, taskId: task.id }),
                ) ?? { status: "loading" },
              ])
            : [],
        );
        return {
          workspace,
          tasks,
          taskSessions,
          workspaceSessions: withRecordStreamError(
            workspaceSessionReads[index],
            live.sessionRecordsError,
          ),
          live: live.statesByWorkspaceId.get(workspace.workspaceId) ?? { kind: "unknown" },
          metadata: metadataByWorkspaceId.get(workspace.workspaceId) ?? new Map(),
        };
      }),
      grouping,
    );
  }, [
    grouping,
    listReadByKey,
    live,
    metadataReads,
    metadataTargets,
    taskReads,
    workspaceSessionReads,
    workspaces,
  ]);

  const retrySource = useCallback(
    (issue: SessionNavigationSourceIssue): void => {
      const { repoPath, workspaceId, workspaceName } = issue.workspace;
      if (issue.source === "tasks") {
        void queryClient.refetchQueries({
          queryKey: taskQueryKeys.repoData(repoPath),
          exact: true,
        });
        return;
      }
      if (issue.source === "workspace_sessions") {
        void queryClient.refetchQueries({
          queryKey: workspaceSessionQueryKeys.list(workspaceId, false),
          exact: true,
        });
        return;
      }
      if (issue.source === "task_sessions") {
        const taskIds = listTargets
          .filter((target) => target.repoPath === repoPath)
          .map((target) => target.taskId);
        void retryAgentSessionListQueries(queryClient, repoPath, taskIds).catch(
          (cause: unknown) => {
            toast.error(`Task sessions of ${workspaceName} could not load again.`, {
              description: errorMessage(cause),
            });
          },
        );
      }
    },
    [listTargets, queryClient],
  );

  return { model, retrySource };
}

type ReadResult<Data> = Pick<QueryObserverResult<Data, Error>, "data" | "error" | "status">;

const toRead = <Data>(result: ReadResult<Data>): SessionNavigationRead<Data> => {
  if (result.data !== undefined) {
    return {
      status: "ready",
      data: result.data,
      refreshError: result.status === "error" ? errorMessage(result.error) : null,
    };
  }
  if (result.status === "error") return { status: "error", message: errorMessage(result.error) };
  return { status: "loading" };
};

const toReads = <Data>(results: ReadResult<Data>[]): SessionNavigationRead<Data>[] =>
  results.map(toRead);

const combineTaskReads = (
  results: ReadResult<{ tasks: TaskCard[] }>[],
): SessionNavigationRead<TaskCard[]>[] =>
  toReads(results).map((read) =>
    read.status === "ready"
      ? { ...read, data: read.data.tasks.filter((task) => task.status !== "closed") }
      : read,
  );

const combineTaskSessionReads = (
  reads: AgentSessionListRead[],
  targets: readonly AgentSessionListTarget[],
): ReadonlyMap<string, SessionNavigationRead<AgentSessionRecord[]>> =>
  new Map(
    reads.flatMap((read, index) => {
      const target = targets[index];
      return target ? [[agentSessionListTargetKey(target), toRead(read)] as const] : [];
    }),
  );

/** A broken record stream means the chat list can be out of date. */
const withRecordStreamError = (
  read: SessionNavigationRead<WorkspaceSession[]> | undefined,
  sessionRecordsError: string | null,
): SessionNavigationRead<WorkspaceSession[]> => {
  if (!read) return { status: "loading" };
  if (read.status !== "ready" || sessionRecordsError === null || read.refreshError !== null) {
    return read;
  }
  return { ...read, refreshError: sessionRecordsError };
};

type MetadataTarget = { workspaceId: string; input: LoadAgentSessionMetadataInput };
