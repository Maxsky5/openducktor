import type {
  AgentSessionLiveRef,
  AgentSessionModelSettings,
  WorkspaceSession,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostValidationError,
  toHostOperationError,
  type HostError,
} from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { SpeedCommit } from "../../ports/agent-session-persistence-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";

/** Write under the caller's turn hold. Return the publish effect so the caller can confirm live state before sending the event. */
export const createSessionSpeedWriter =
  ({
    store,
    taskStore,
    settings,
    publishWorkspace,
    publishTask,
  }: {
    store: WorkspaceSessionStorePort;
    taskStore: Pick<TaskStorePort, "listAgentSessionsForTasks" | "updateAgentSessionModel">;
    settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
    publishWorkspace(
      workspaceId: string,
      session: WorkspaceSession,
    ): Effect.Effect<void, HostError>;
    publishTask(repoPath: string, taskId: string): Effect.Effect<void, HostError>;
  }) =>
  (
    ref: AgentSessionLiveRef,
    speed: string | null,
    commit: SpeedCommit,
    model?: AgentSessionModelSettings,
    previousChoice?: string | null,
  ): Effect.Effect<Effect.Effect<void, HostError>, HostError> =>
    Effect.gen(function* () {
      const config = yield* settings.getRepoConfigByRepoPath(ref.repoPath);
      const scope = { workspaceId: config.workspaceId, repoPath: ref.repoPath };
      const session = yield* store.findByRuntimeSession({ ...scope, ...ref });
      if (session) {
        if (previousChoice !== undefined && session.speed !== previousChoice)
          return yield* new HostValidationError({
            field: "speed",
            message:
              "The saved speed choice changed before this native report. Set speed explicitly.",
          });
        if (session.executionTarget.workingDirectory !== ref.workingDirectory)
          return yield* new HostValidationError({
            field: "workingDirectory",
            message: "The Workspace Session directory does not match its runtime.",
          });
        const saved = yield* commit(
          model
            ? store.setSelectedModel({
                ...scope,
                sessionId: session.id,
                selectedModel: { ...model, runtimeKind: ref.runtimeKind },
                speed,
              })
            : store.setSpeed({ ...scope, sessionId: session.id, speed }),
        );
        return commit(publishWorkspace(scope.workspaceId, saved));
      }
      const owners = yield* store.listRuntimeOwners(scope);
      const owner = owners.find(
        (entry) =>
          entry.kind === "task" &&
          entry.runtimeKind === ref.runtimeKind &&
          entry.externalSessionId === ref.externalSessionId,
      );
      if (!owner || owner.kind !== "task")
        return yield* new HostValidationError({
          field: "externalSessionId",
          message:
            "This conversation no longer has a saved owner. Import it before changing speed.",
        });
      const records = yield* taskStore.listAgentSessionsForTasks({
        repoPath: ref.repoPath,
        taskIds: [owner.taskId],
      });
      const record = records[0]?.agentSessions.find(
        (entry) =>
          entry.externalSessionId === ref.externalSessionId &&
          entry.runtimeKind === ref.runtimeKind &&
          entry.workingDirectory === ref.workingDirectory,
      );
      if (!record)
        return yield* new HostValidationError({
          field: "externalSessionId",
          message: "The task no longer owns this conversation.",
        });
      if (
        previousChoice !== undefined &&
        (record.speed === undefined ? "standard" : record.speed) !== previousChoice
      )
        return yield* new HostValidationError({
          field: "speed",
          message:
            "The saved speed choice changed before this native report. Set speed explicitly.",
        });
      const updated = yield* commit(
        taskStore.updateAgentSessionModel({
          repoPath: ref.repoPath,
          taskId: owner.taskId,
          identity: ref,
          selectedModel: model ? { ...model, runtimeKind: ref.runtimeKind } : record.selectedModel,
          speed,
        }),
      );
      if (!updated)
        return yield* new HostValidationError({
          field: "externalSessionId",
          message: "The saved session changed before speed could commit.",
        });
      return commit(publishTask(ref.repoPath, owner.taskId));
    }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "agent-session.persist-speed")));
