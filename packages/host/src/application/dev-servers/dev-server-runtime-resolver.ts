import {
  type DevServerCommandInput,
  type DevServerOwner,
  formatDevServerOwnerKey,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostDependencyError, HostValidationError } from "../../effect/host-errors";
import { validateWorkspaceSessionTarget } from "../workspaces/workspace-session-target";
import type { CreateDevServerServiceInput } from "./dev-server-service-types";
import {
  buildGroupState,
  type DevServerGroupRuntime,
  nowIso,
  syncGroupState,
  syncRuntimeTerminalBufferByteCounts,
} from "./dev-server-state";
import type { DevServerProcessHandle } from "../../ports/dev-server-process-port";

type ResolverDependencies = {
  groups: Map<string, Map<string, DevServerGroupRuntime>>;
  taskWorktreeService: CreateDevServerServiceInput["taskWorktreeService"];
  workspaceSessions: CreateDevServerServiceInput["workspaceSessions"];
  workspaceSettingsService: CreateDevServerServiceInput["workspaceSettingsService"];
};

export const createDevServerRuntimeResolver = ({
  groups,
  taskWorktreeService,
  workspaceSessions,
  workspaceSettingsService,
}: ResolverDependencies) => {
  const getRuntime = (
    owner: DevServerOwner,
    repoConfig: RepoConfig,
    workingDirectory: string | null,
  ) =>
    Effect.sync(() => {
      const repoGroups =
        groups.get(repoConfig.repoPath) ?? new Map<string, DevServerGroupRuntime>();
      const ownerKey = formatDevServerOwnerKey(owner);
      const existing = repoGroups.get(ownerKey);
      if (existing) {
        const activeDirectory =
          existing.processes.size > 0 || existing.unresolvedStops.size > 0
            ? existing.state.workingDirectory
            : workingDirectory;
        syncGroupState(
          existing.state,
          repoConfig,
          owner,
          activeDirectory,
          existing.unresolvedStops,
        );
        syncRuntimeTerminalBufferByteCounts(existing);
        return existing;
      }
      const runtime = {
        processes: new Map<string, DevServerProcessHandle>(),
        unresolvedStops: new Set<string>(),
        state: buildGroupState(repoConfig, owner, workingDirectory, nowIso()),
        terminalBufferedBytesByScriptId: new Map<string, number>(),
        terminalNextSequenceByScriptId: new Map<string, number>(),
        terminalRunGeneration: 0,
      };
      repoGroups.set(ownerKey, runtime);
      groups.set(repoConfig.repoPath, repoGroups);
      return runtime;
    });

  return (input: DevServerCommandInput, validateTarget = false, knownRepoConfig?: RepoConfig) =>
    Effect.gen(function* () {
      const { repoPath, owner } = input;
      let repoConfig: RepoConfig;
      let workingDirectory: string | null;
      if (owner.kind === "task") {
        repoConfig =
          knownRepoConfig ?? (yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath));
        const worktree = taskWorktreeService
          ? yield* taskWorktreeService.getTaskWorktree({ repoPath, taskId: owner.taskId })
          : null;
        workingDirectory = worktree?.workingDirectory ?? null;
      } else {
        if (!workspaceSessions) {
          return yield* new HostDependencyError({
            dependency: "WorkspaceSessionStorePort",
            operation: "dev_server.resolve_session",
            message: "Workspace Session dev server support is unavailable. Restart the host.",
          });
        }
        repoConfig = yield* workspaceSessions.settings.getRepoConfig(owner.workspaceId);
        if (repoConfig.repoPath !== repoPath) {
          return yield* new HostValidationError({
            field: "repoPath",
            message: `Workspace Session ${owner.sessionId} belongs to ${repoConfig.repoPath}, not ${repoPath}. Reload the Workspace and retry.`,
          });
        }
        const session = yield* workspaceSessions.store.get({ ...owner, repoPath });
        if (session.archivedAt !== null) {
          return yield* new HostValidationError({
            field: "sessionId",
            message: `Workspace Session ${owner.sessionId} is archived. Restore it before using dev servers.`,
          });
        }
        workingDirectory = session.executionTarget.workingDirectory;
        if (validateTarget) {
          if (
            session.executionTarget.kind === "local_worktree" &&
            session.executionTarget.worktreeState === "removed"
          ) {
            return yield* new HostValidationError({
              field: "workingDirectory",
              message: `Workspace Session ${owner.sessionId} worktree was removed at ${workingDirectory}. Restore the session worktree before starting dev servers.`,
            });
          }
          const targetResult = yield* Effect.either(
            validateWorkspaceSessionTarget(workspaceSessions, repoPath, session.executionTarget),
          );
          if (targetResult._tag === "Left") {
            return yield* new HostValidationError({
              field: "workingDirectory",
              message: `Workspace Session ${owner.sessionId} directory ${workingDirectory} is unavailable or invalid: ${errorMessage(targetResult.left)}`,
              cause: targetResult.left,
            });
          }
        }
      }
      const runtime = yield* getRuntime(owner, repoConfig, workingDirectory);
      return { repoConfig, runtime, workingDirectory };
    });
};
