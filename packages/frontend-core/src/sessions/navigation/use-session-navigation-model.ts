import type {
  AgentSessionRecord,
  SidebarSessionGrouping,
  TaskCard,
  WorkspaceSession,
} from "@openducktor/contracts";
import {
  type QueryObserverResult,
  replaceEqualDeep,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
import {
  buildSessionNavigationModel,
  type SessionNavigationEntry,
  type SessionNavigationModel,
  type SessionNavigationRead,
  type SessionNavigationSourceIssue,
  type SessionNavigationWorkspace,
} from "./session-navigation-read-model";
import {
  loadAgentSessionListsFromQuery,
  normalizeAgentSessionTaskIds,
  retryAgentSessionListQueries,
} from "../../queries/agent-sessions";
import {
  type AgentSessionListRead,
  type AgentSessionListTarget,
  agentSessionListTargetKey,
  useAgentSessionListQueries,
} from "../../queries/use-agent-session-lists";
import { repoTaskDataQueryOptions, taskQueryKeys } from "../../queries/tasks";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "../../queries/workspace-sessions";
import { useWorkspaceSessionLiveSnapshot } from "../../workspace-activity/workspace-activity-context";

export type SessionNavigationModelResult = {
  model: SessionNavigationModel;
  /** Read a failed source again. Live status recovers through its own stream. */
  retrySource: (issue: SessionNavigationSourceIssue) => void;
  /**
   * Read the tasks, the chats, and the task sessions of one workspace again, or of every workspace
   * for null, as a pull to refresh does. A failed read shows as a source issue of the model. Live
   * status recovers through its own stream.
   */
  refresh: (workspaceId: string | null) => Promise<void>;
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
  const { feedback } = useClientConnection();

  const taskReads = useQueries({
    queries: workspaces.map((workspace) => repoTaskDataQueryOptions(workspace.repoPath)),
    combine: combineTaskReads,
  });

  const workspaceSessionReads = useQueries({
    queries: workspaces.map((workspace) => workspaceSessionListQueryOptions(workspace.workspaceId)),
    combine: toSessionNavigationReads<WorkspaceSession[]>,
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

  const live = useWorkspaceSessionLiveSnapshot();

  const previousModel = useRef<SessionNavigationModel | undefined>(undefined);
  const model = useMemo(() => {
    return shareSessionNavigationModel(
      previousModel.current,
      buildSessionNavigationModel(
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
            workspace: {
              workspaceId: workspace.workspaceId,
              workspaceName: workspace.workspaceName,
              repoPath: workspace.repoPath,
              abbreviation: workspace.abbreviation,
              tileColor: workspace.tileColor,
              iconDataUrl: workspace.iconDataUrl,
            },
            tasks,
            taskSessions,
            workspaceSessions: withRecordStreamError(
              workspaceSessionReads[index],
              live.sessionRecordsError,
            ),
            live: live.statesByWorkspaceId.get(workspace.workspaceId) ?? { kind: "unknown" },
          };
        }),
        grouping,
      ),
    );
  }, [grouping, listReadByKey, live, taskReads, workspaceSessionReads, workspaces]);
  useLayoutEffect(() => {
    previousModel.current = model;
  }, [model]);

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
            feedback.show("error", `Task sessions of ${workspaceName} could not load again.`, {
              description: errorMessage(cause),
            });
          },
        );
      }
    },
    [feedback, listTargets, queryClient],
  );

  const refresh = useCallback(
    async (workspaceId: string | null): Promise<void> => {
      const refreshed = workspaces.filter(
        (workspace) => workspaceId === null || workspace.workspaceId === workspaceId,
      );
      await Promise.all(
        refreshed.flatMap((workspace) => [
          queryClient.refetchQueries({
            queryKey: taskQueryKeys.repoData(workspace.repoPath),
            exact: true,
          }),
          queryClient.refetchQueries({
            queryKey: workspaceSessionQueryKeys.list(workspace.workspaceId, false),
            exact: true,
          }),
          loadAgentSessionListsFromQuery(
            queryClient,
            workspace.repoPath,
            listTargets
              .filter((target) => target.repoPath === workspace.repoPath)
              .map((target) => target.taskId),
            { forceFresh: true },
          ),
        ]),
      );
    },
    [listTargets, queryClient, workspaces],
  );

  return { model, retrySource, refresh };
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

/** Query results as reads that keep their last data beside a failed refresh. */
export const toSessionNavigationReads = <Data>(
  results: ReadResult<Data>[],
): SessionNavigationRead<Data>[] => results.map(toRead);

const combineTaskReads = (
  results: ReadResult<{ tasks: TaskCard[] }>[],
): SessionNavigationRead<TaskCard[]>[] =>
  toSessionNavigationReads(results).map((read) =>
    read.status === "ready"
      ? { ...read, data: read.data.tasks.filter((task) => task.status !== "closed") }
      : read,
  );

export const combineTaskSessionReads = (
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
export const withRecordStreamError = (
  read: SessionNavigationRead<WorkspaceSession[]> | undefined,
  sessionRecordsError: string | null,
): SessionNavigationRead<WorkspaceSession[]> => {
  if (!read) return { status: "loading" };
  if (read.status !== "ready" || sessionRecordsError === null || read.refreshError !== null) {
    return read;
  }
  return { ...read, refreshError: sessionRecordsError };
};

/**
 * The next model with each object of the previous model that did not change, so a live change
 * renders only the rows that it changes. A deep comparison of the whole model cost more than its
 * build, so entries match by key and compare their own fields. Their records compare by object:
 * the query caches keep the object of a record that did not change.
 */
const shareSessionNavigationModel = (
  previous: SessionNavigationModel | undefined,
  next: SessionNavigationModel,
): SessionNavigationModel => {
  if (!previous) return next;
  const previousEntries = new Map<string, SessionNavigationEntry>();
  for (const group of previous.groups) {
    for (const entry of group.entries) previousEntries.set(entry.key, entry);
  }
  const groups = next.groups.map((group, index) => {
    const entries = group.entries.map((entry) => {
      const kept = previousEntries.get(entry.key);
      return kept && sameEntry(kept, entry) ? kept : entry;
    });
    const before = previous.groups[index];
    return before?.id === group.id && sameItems(before.entries, entries)
      ? before
      : { id: group.id, entries };
  });
  const shared: SessionNavigationModel = {
    groups: sameItems(previous.groups, groups) ? previous.groups : groups,
    entryCount: next.entryCount,
    isLoading: next.isLoading,
    loadingWorkspaceIds: replaceEqualDeep(previous.loadingWorkspaceIds, next.loadingWorkspaceIds),
    issues: replaceEqualDeep(previous.issues, next.issues),
    taskBlocks: replaceEqualDeep(previous.taskBlocks, next.taskBlocks),
  };
  const unchanged =
    shared.groups === previous.groups &&
    shared.entryCount === previous.entryCount &&
    shared.isLoading === previous.isLoading &&
    shared.loadingWorkspaceIds === previous.loadingWorkspaceIds &&
    shared.issues === previous.issues &&
    shared.taskBlocks === previous.taskBlocks;
  return unchanged ? previous : shared;
};

const sameItems = <Item>(left: readonly Item[], right: readonly Item[]): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const sameEntry = (left: SessionNavigationEntry, right: SessionNavigationEntry): boolean =>
  left.title === right.title &&
  left.runtimeKind === right.runtimeKind &&
  left.workflowTone === right.workflowTone &&
  left.startedAt === right.startedAt &&
  left.fault === right.fault &&
  sameTarget(left.target, right.target) &&
  sameWorkspace(left.workspace, right.workspace) &&
  sameItems(left.attention, right.attention) &&
  sameStatus(left.status, right.status) &&
  sameTime(left.time, right.time) &&
  sameContext(left.context, right.context);

// The entry key holds the workspace and the session identity of a target.
const sameTarget = (
  left: SessionNavigationEntry["target"],
  right: SessionNavigationEntry["target"],
): boolean => {
  if (left.kind === "workspace_session") return right.kind === "workspace_session";
  return right.kind === left.kind && right.taskId === left.taskId && right.role === left.role;
};

const sameWorkspace = (
  left: SessionNavigationEntry["workspace"],
  right: SessionNavigationEntry["workspace"],
): boolean =>
  left === right ||
  (left.workspaceId === right.workspaceId &&
    left.workspaceName === right.workspaceName &&
    left.repoPath === right.repoPath &&
    left.abbreviation === right.abbreviation &&
    left.tileColor === right.tileColor &&
    left.iconDataUrl === right.iconDataUrl);

const sameStatus = (
  left: SessionNavigationEntry["status"],
  right: SessionNavigationEntry["status"],
): boolean => {
  if (left.kind === "settled") return right.kind === "settled" && right.failed === left.failed;
  if (left.kind === "unavailable") {
    return right.kind === "unavailable" && right.reason === left.reason;
  }
  return right.kind === left.kind;
};

const sameTime = (
  left: SessionNavigationEntry["time"],
  right: SessionNavigationEntry["time"],
): boolean => {
  if (left.kind === "none") return right.kind === "none";
  return right.kind === left.kind && right.at === left.at;
};

const sameContext = (
  left: SessionNavigationEntry["context"],
  right: SessionNavigationEntry["context"],
): boolean => {
  if (left.kind === "workspace")
    return right.kind === "workspace" && right.session === left.session;
  return right.kind === "task" && right.task === left.task && right.sessions === left.sessions;
};
