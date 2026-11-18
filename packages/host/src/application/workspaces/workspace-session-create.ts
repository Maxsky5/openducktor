import {
  type RepoConfig,
  type WorkspaceSession,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionCreateResult,
  type WorkspaceSessionExecutionTarget,
  workspaceSessionCreateInputSchema,
  workspaceSessionRenameInputSchema,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { startupStep, updateStartup } from "../agent-sessions/session-startup-progress";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";
import {
  withWorkspaceSessionTarget,
  type WorkspaceSessionDestination,
  type WorkspaceSessionTargetCreationDependencies,
} from "./workspace-session-target";
import {
  automaticWorktreeName,
  temporaryWorkspaceBranch,
  type WorkspaceSessionCreationFacts,
} from "./workspace-session-naming";

export type WorkspaceSessionCreateDependencies = WorkspaceSessionTargetCreationDependencies & {
  store: Pick<WorkspaceSessionStorePort, "create">;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "listCustomAgentRoles">;
  facts: WorkspaceSessionCreationFacts;
};

/**
 * The destination of a new chat. A new worktree without a name gets the first digits of the
 * session ID as its folder, and, without a branch name, as its temporary branch. Only a workspace
 * with a naming model accepts a blank name.
 */
const resolveDestination = (
  input: WorkspaceSessionCreateInput,
  config: Pick<RepoConfig, "branchPrefix" | "namingModel">,
  sessionId: string,
) => {
  const typed: WorkspaceSessionDestination = input;
  if (
    input.location !== "local_worktree" ||
    input.worktree.mode !== "from_name" ||
    input.worktree.name !== ""
  )
    return Effect.succeed({ destination: typed, temporaryBranch: null });
  if (!config.namingModel)
    return Effect.fail(
      new HostValidationError({
        field: "worktree.name",
        message:
          "Enter a worktree name. To leave it blank, select a naming model in the workspace settings.",
      }),
    );
  const temporaryBranch =
    input.worktree.branchName === null
      ? temporaryWorkspaceBranch(config.branchPrefix, sessionId)
      : null;
  const destination: WorkspaceSessionDestination = {
    location: "local_worktree",
    worktree: {
      ...input.worktree,
      name: automaticWorktreeName(sessionId),
      branchName: input.worktree.branchName ?? temporaryBranch,
    },
  };
  return Effect.succeed({ destination, temporaryBranch });
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
      const { destination, temporaryBranch } = yield* resolveDestination(input, config, sessionId);
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
          const saved = yield* startupStep(
            { id: "save", label: "Save workspace session" },
            dependencies.store
              .create({
                workspaceId: input.workspaceId,
                repoPath,
                session,
              })
              .pipe(
                Effect.tapError(() =>
                  updateStartup((progress) => progress.ownership({ state: "unknown" })),
                ),
              ),
          );
          dependencies.facts.created(
            { workspaceId: input.workspaceId, sessionId },
            temporaryBranch,
          );
          yield* updateStartup((progress) =>
            progress.ownership({ state: "saved", target: { kind: "workspace", record: saved } }),
          );
          return { session: saved } satisfies WorkspaceSessionCreateResult;
        });
      return yield* withWorkspaceSessionTarget(
        dependencies,
        {
          owner: { workspaceId: input.workspaceId, sessionId },
          destination,
          repoConfig: { ...config, repoPath },
          targetBranch: input.targetBranch,
          deferUpstream: temporaryBranch !== null,
        },
        (executionTarget, retainTarget) =>
          save(executionTarget).pipe(Effect.tap(() => Effect.sync(retainTarget))),
      );
    });
