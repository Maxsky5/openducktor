import type { AgentSessionRecord, WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  combineTaskSessionReads,
  toSessionNavigationReads,
  withRecordStreamError,
} from "@openducktor/frontend-core/sessions/navigation/use-session-navigation-model";
import type { WorkspaceSessionLiveSnapshot } from "@openducktor/frontend-core/workspace-activity/workspace-activity-observer";
import {
  UNKNOWN_WORKSPACE_SESSION_LIVE_STATE,
  type WorkspaceSessionLiveState,
} from "@openducktor/frontend-core/workspace-activity/workspace-activity-state";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { normalizeAgentSessionTaskIds } from "@openducktor/frontend-core/queries/agent-sessions";
import {
  type RepoTaskData,
  repoTaskDataQueryOptions,
} from "@openducktor/frontend-core/queries/tasks";
import {
  type AgentSessionListTarget,
  agentSessionListTargetKey,
  useAgentSessionListQueries,
} from "@openducktor/frontend-core/queries/use-agent-session-lists";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import {
  buildSessionNavigationModel,
  type SessionNavigationEntry,
  type SessionNavigationModel,
  type SessionNavigationRead,
  type SessionNavigationSourceIssue,
  type SessionNavigationWorkspaceSources,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { useWorkspaceSessionLiveSnapshot } from "@openducktor/frontend-core/workspace-activity/workspace-activity-context";
import { paletteChatKey, paletteTaskKey } from "./command-palette-row-keys";
import type { PaletteChat, PaletteTask } from "./command-palette-types";

export type CommandPaletteData = {
  tasks: PaletteTask[];
  chats: PaletteChat[];
  /** Saved sessions of each task by task key. A missing key means the read has not started. */
  sessionsByTaskKey: ReadonlyMap<string, SessionNavigationRead<AgentSessionRecord[]>>;
  live: WorkspaceSessionLiveSnapshot;
  /** Workspaces whose task and chat reads finished, with data or with an error. */
  loadedWorkspaceIds: ReadonlySet<string>;
  isLoading: boolean;
  issues: SessionNavigationSourceIssue[];
  /**
   * The sidebar entries of each task and chat row, by row key. Entries that need you come first,
   * so the first entry gives the status dot of the row.
   */
  sessionEntriesByKey: ReadonlyMap<string, SessionNavigationEntry[]>;
  /** Row keys of the tasks and chats that need you, in sidebar order. */
  needsYouKeys: string[];
};

export const liveStateOf = (
  live: WorkspaceSessionLiveSnapshot,
  workspaceId: string,
): WorkspaceSessionLiveState =>
  live.statesByWorkspaceId.get(workspaceId) ?? UNKNOWN_WORKSPACE_SESSION_LIVE_STATE;

/**
 * Read the tasks, chats, and task sessions of the scoped workspaces with the shared queries of
 * the Kanban board and the sidebar. Mount it only while the palette is open.
 */
export function useCommandPaletteData(workspaces: readonly WorkspaceRecord[]): CommandPaletteData {
  const queryClient = useQueryClient();
  const taskReads = useQueries({
    queries: workspaces.map((workspace) => repoTaskDataQueryOptions(workspace.repoPath)),
    combine: toSessionNavigationReads<RepoTaskData>,
  });
  const chatReads = useQueries({
    queries: workspaces.map((workspace) => workspaceSessionListQueryOptions(workspace.workspaceId)),
    combine: toSessionNavigationReads<WorkspaceSession[]>,
  });

  const tasks = useMemo(
    () =>
      workspaces.flatMap((workspace, index) => {
        const read = taskReads[index];
        if (read?.status !== "ready") return [];
        return read.data.tasks.map((task) => ({
          key: paletteTaskKey(workspace.workspaceId, task.id),
          workspace,
          task,
        }));
      }),
    [taskReads, workspaces],
  );

  const chats = useMemo(
    () =>
      workspaces.flatMap((workspace, index) => {
        const read = chatReads[index];
        if (read?.status !== "ready") return [];
        return read.data.flatMap((session) =>
          session.archivedAt === null
            ? [
                {
                  key: paletteChatKey(workspace.workspaceId, session.id),
                  workspace,
                  session,
                  title: workspaceSessionTitle(session),
                },
              ]
            : [],
        );
      }),
    [chatReads, workspaces],
  );

  const listTargets = useMemo(
    () =>
      workspaces.flatMap((workspace, index) => {
        const read = taskReads[index];
        if (read?.status !== "ready") return [];
        return normalizeAgentSessionTaskIds(read.data.tasks.map((task) => task.id)).map(
          (taskId) => ({ repoPath: workspace.repoPath, taskId }),
        );
      }),
    [taskReads, workspaces],
  );
  const sessionReadsByTarget = useAgentSessionListQueries({
    targets: listTargets,
    enabled: true,
    queryClient,
    combine: combineTaskSessionReads,
  });
  const sessionsByTaskKey = useMemo(() => {
    const byKey = new Map<string, SessionNavigationRead<AgentSessionRecord[]>>();
    for (const { workspace, task, key } of tasks) {
      const read = sessionReadsByTarget.get(
        agentSessionListTargetKey({ repoPath: workspace.repoPath, taskId: task.id }),
      );
      if (read) byKey.set(key, read);
    }
    return byKey;
  }, [sessionReadsByTarget, tasks]);

  const live = useWorkspaceSessionLiveSnapshot();
  // Live updates come often, so the grouping of session reads by workspace stays out of them.
  const taskSessionsByRepo = useMemo(
    () => groupTaskSessionsByRepo(listTargets, sessionReadsByTarget),
    [listTargets, sessionReadsByTarget],
  );

  const status = useMemo(() => {
    const sources: SessionNavigationWorkspaceSources[] = workspaces.map((workspace, index) => {
      const taskRead = taskReads[index] ?? { status: "loading" };
      return {
        workspace,
        tasks: taskRead.status === "ready" ? { ...taskRead, data: taskRead.data.tasks } : taskRead,
        taskSessions: taskSessionsByRepo.get(workspace.repoPath) ?? NO_TASK_SESSIONS,
        workspaceSessions: withRecordStreamError(chatReads[index], live.sessionRecordsError),
        live: liveStateOf(live, workspace.workspaceId),
      };
    });
    const loadedWorkspaceIds = new Set(
      sources.flatMap(({ workspace, tasks: taskRead, workspaceSessions }) =>
        taskRead.status !== "loading" && workspaceSessions.status !== "loading"
          ? [workspace.workspaceId]
          : [],
      ),
    );
    // The sidebar builds its rows and problems from the same sources, so both show the same state.
    const model = buildSessionNavigationModel(sources, "task");
    return {
      loadedWorkspaceIds,
      issues: model.issues,
      isLoading: loadedWorkspaceIds.size < workspaces.length,
      ...sessionEntriesByRow(model),
    };
  }, [chatReads, live, taskReads, taskSessionsByRepo, workspaces]);

  return useMemo(
    () => ({ tasks, chats, sessionsByTaskKey, live, ...status }),
    [chats, live, sessionsByTaskKey, status, tasks],
  );
}

/** The sidebar entries of each palette row. The model lists the entries that need you first. */
const sessionEntriesByRow = (
  model: SessionNavigationModel,
): Pick<CommandPaletteData, "sessionEntriesByKey" | "needsYouKeys"> => {
  const sessionEntriesByKey = new Map<string, SessionNavigationEntry[]>();
  const needsYouKeys = new Set<string>();
  for (const group of model.groups) {
    for (const entry of group.entries) {
      const key = rowKeyOf(entry);
      const entries = sessionEntriesByKey.get(key);
      if (entries) entries.push(entry);
      else sessionEntriesByKey.set(key, [entry]);
      if (group.id === "needs_you") needsYouKeys.add(key);
    }
  }
  return { sessionEntriesByKey, needsYouKeys: [...needsYouKeys] };
};

/** The palette row of a sidebar entry: its task or its chat. */
const rowKeyOf = ({ target }: SessionNavigationEntry): string =>
  target.kind === "workspace_session"
    ? paletteChatKey(target.workspaceId, target.sessionId)
    : paletteTaskKey(target.workspaceId, target.taskId);

type TaskSessionReads = ReadonlyMap<string, SessionNavigationRead<AgentSessionRecord[]>>;

const NO_TASK_SESSIONS: TaskSessionReads = new Map();

/** The task session reads of each repository, by task ID. */
const groupTaskSessionsByRepo = (
  targets: readonly AgentSessionListTarget[],
  readsByTarget: ReadonlyMap<string, SessionNavigationRead<AgentSessionRecord[]>>,
): ReadonlyMap<string, TaskSessionReads> => {
  const byRepo = new Map<string, Map<string, SessionNavigationRead<AgentSessionRecord[]>>>();
  for (const target of targets) {
    const read = readsByTarget.get(agentSessionListTargetKey(target));
    if (!read) continue;
    const reads = byRepo.get(target.repoPath);
    if (reads) reads.set(target.taskId, read);
    else byRepo.set(target.repoPath, new Map([[target.taskId, read]]));
  }
  return byRepo;
};
