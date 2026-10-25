import {
  type WorkspaceSession,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionCreateResult,
  type WorkspaceSessionExecutionTarget,
  workspaceSessionCreateInputSchema,
  workspaceSessionRenameInputSchema,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";
import {
  withWorkspaceSessionTarget,
  type WorkspaceSessionTargetCreationDependencies,
} from "./workspace-session-target";

export type WorkspaceSessionCreateDependencies = WorkspaceSessionTargetCreationDependencies & {
  store: Pick<WorkspaceSessionStorePort, "create">;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "listCustomAgentRoles">;
};

/** Saves a fresh draft chat in the current checkout, a new worktree, or an existing worktree. */
export const createWorkspaceSessionCreate =
  (dependencies: WorkspaceSessionCreateDependencies) => (rawInput: WorkspaceSessionCreateInput) =>
    Effect.gen(function* () {
      const input = yield* Effect.try({
        try: () => workspaceSessionCreateInputSchema.parse(rawInput),
        catch: (cause) =>
          new HostValidationError({
            message: "Invalid Workspace Session creation input.",
            cause,
          }),
      });
      const manualTitle = yield* Effect.try({
        try: () =>
          workspaceSessionRenameInputSchema.shape.manualTitle.parse(input.manualTitle) || null,
        catch: (cause) =>
          new HostValidationError({
            message: "Workspace Session title must be at most 120 characters.",
            field: "manualTitle",
            cause,
          }),
      });
      const sessionId = crypto.randomUUID();
      const config = yield* dependencies.settings.getRepoConfig(input.workspaceId);
      const roles =
        input.customAgentRoleId === null ? [] : yield* dependencies.settings.listCustomAgentRoles();
      const role = roles.find((candidate) => candidate.id === input.customAgentRoleId);
      if (input.customAgentRoleId !== null && !role) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: input.customAgentRoleId,
            operation: "workspaceSession.create",
            message:
              "The selected Custom Agent Role no longer exists. Select another Role or No Role.",
          }),
        );
      }
      const roleSnapshot = role ? { ...role } : null;
      const repoPath = yield* dependencies.git.canonicalizePath(config.repoPath);
      const save = (executionTarget: WorkspaceSessionExecutionTarget) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const session: WorkspaceSession = {
            id: sessionId,
            runtimeKind: input.runtimeKind,
            externalSessionId: null,
            executionTarget,
            roleSnapshot,
            selectedModel: input.selectedModel,
            generatedTitle: null,
            manualTitle,
            targetBranch: input.targetBranch,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          };
          const saved = yield* dependencies.store.create({
            workspaceId: input.workspaceId,
            repoPath,
            session,
          });
          return { session: saved } satisfies WorkspaceSessionCreateResult;
        });
      return yield* withWorkspaceSessionTarget(
        dependencies,
        {
          owner: { workspaceId: input.workspaceId, sessionId },
          destination: input,
          repoConfig: { ...config, repoPath },
          targetBranch: input.targetBranch,
        },
        (executionTarget, retainTarget) =>
          save(executionTarget).pipe(Effect.tap(() => Effect.sync(retainTarget))),
      );
    });
