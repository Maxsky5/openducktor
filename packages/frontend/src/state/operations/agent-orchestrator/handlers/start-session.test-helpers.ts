import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { RuntimeInfo } from "../runtime/runtime";
import type { StartSessionDependencies } from "./start-session";

const ensureRuntimeWithKind = async (
  ...args: Parameters<StartSessionDependencies["runtime"]["ensureRuntime"]>
): Promise<RuntimeInfo> => {
  const [, , , options] = args;
  const runtimeKind = options?.runtimeKind ?? DEFAULT_RUNTIME_KIND;
  const workingDirectory = options?.targetWorkingDirectory ?? "/tmp/repo";

  return {
    kind: runtimeKind,
    runtimeKind,
    workingDirectory,
  };
};

const withRuntimeKind = async (
  ensureRuntime: StartSessionDependencies["runtime"]["ensureRuntime"],
  ...args: Parameters<StartSessionDependencies["runtime"]["ensureRuntime"]>
): Promise<RuntimeInfo> => {
  const runtime = await ensureRuntime(...args);
  return runtime;
};

export type FlatStartSessionDependencies = Omit<
  StartSessionDependencies["repo"],
  "activeWorkspace"
> & {
  activeRepo?: string | null;
  activeWorkspaceId?: string | null;
  loadRepoDefaultModel?: unknown;
} & StartSessionDependencies["session"] &
  Omit<StartSessionDependencies["runtime"], "resolveTaskWorktree"> &
  Partial<Pick<StartSessionDependencies["runtime"], "resolveTaskWorktree">> &
  StartSessionDependencies["task"] &
  StartSessionDependencies["model"];

export const toStartSessionDependencies = (
  deps: FlatStartSessionDependencies,
): StartSessionDependencies => {
  return {
    repo: {
      activeWorkspace:
        deps.activeRepo == null
          ? null
          : {
              repoPath: deps.activeRepo,
              workspaceId: deps.activeWorkspaceId ?? "workspace-1",
              workspaceName: "Active Workspace",
            },
      repoEpochRef: deps.repoEpochRef,
      currentWorkspaceRepoPathRef: deps.currentWorkspaceRepoPathRef,
    },
    session: {
      setSessionsById: deps.setSessionsById,
      sessionsRef: deps.sessionsRef,
      inFlightStartsByWorkspaceTaskRef: deps.inFlightStartsByWorkspaceTaskRef,
      loadAgentSessions: deps.loadAgentSessions,
      persistSessionRecord: deps.persistSessionRecord,
      listenToAgentSession: deps.listenToAgentSession,
    },
    runtime: {
      adapter: deps.adapter,
      resolveTaskWorktree:
        deps.resolveTaskWorktree ??
        (async () => ({
          workingDirectory: "/tmp/repo/worktree",
          source: "active_build_run",
        })),
      ensureRuntime: (...args) =>
        withRuntimeKind(deps.ensureRuntime ?? ensureRuntimeWithKind, ...args),
    },
    task: {
      taskRef: deps.taskRef,
      loadTaskDocuments: deps.loadTaskDocuments,
      refreshTaskData: deps.refreshTaskData,
      sendAgentMessage: deps.sendAgentMessage,
    },
    model: {
      loadRepoPromptOverrides: deps.loadRepoPromptOverrides,
    },
  };
};
