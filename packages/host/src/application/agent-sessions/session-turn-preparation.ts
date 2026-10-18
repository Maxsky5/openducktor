import type {
  AgentMessageTarget,
  AgentSessionModelSelection,
  RepoPromptOverrides,
} from "@openducktor/contracts";
import {
  buildAgentSystemPrompt,
  mergePromptOverrides,
  resolveSavedSessionModel,
  isSameSelection,
  resolveModelSelectionPolicy,
  findCatalogModel,
  resolveSavedModelAlias,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";

type PreparationTarget = Omit<AgentMessageTarget, "externalSessionId">;

export const createSessionTurnPreparation = (deps: {
  settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath" | "getSettingsSnapshot">;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog">;
  taskReader: Pick<TaskStorePort, "getTask">;
}) => {
  const catalogFor = (target: PreparationTarget) =>
    Effect.gen(function* () {
      const read = yield* deps.queries.loadRuntimeCatalog(target);
      if (read.models?.status !== "available")
        return yield* new HostValidationError({
          field: "model",
          message: `The selected runtime model catalog is unavailable: ${read.models?.status === "failed" ? read.models.message : "no catalog was returned"}. Refresh the catalog before changing session settings.`,
        });
      return read.models.catalog;
    });
  const settingsFor = (target: PreparationTarget) =>
    Effect.gen(function* () {
      const config = yield* deps.settings.getRepoConfigByRepoPath(target.repoPath);
      const settings = yield* deps.settings.getSettingsSnapshot();
      return mergePromptOverrides({
        globalOverrides: settings.globalPromptOverrides,
        repoOverrides: config.promptOverrides,
      });
    });
  return {
    promptOverrides: (
      target: AgentMessageTarget,
    ): Effect.Effect<RepoPromptOverrides, import("../../effect/host-errors").HostError> =>
      settingsFor(target).pipe(
        Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-context")),
      ),
    context: (target: PreparationTarget) =>
      Effect.gen(function* () {
        if (target.sessionScope.kind === "repository") return undefined;
        const overrides = yield* settingsFor(target);
        const task = yield* deps.taskReader.getTask({
          repoPath: target.repoPath,
          taskId: target.sessionScope.taskId,
        });
        return buildAgentSystemPrompt({
          role: target.sessionScope.role,
          task: {
            taskId: task.id,
            title: task.title,
            issueType: task.issueType,
            status: task.status,
            qaRequired: task.aiReviewEnabled,
            description: task.description,
          },
          overrides,
        });
      }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-context"))),
    model: (
      target: PreparationTarget,
      saved: AgentSessionModelSelection | null,
      previous?: AgentSessionModelSelection | null,
    ) =>
      Effect.gen(function* () {
        if (saved?.runtimeKind && saved.runtimeKind !== target.runtimeKind)
          return yield* new HostValidationError({
            field: "model",
            message:
              "The selected model belongs to another runtime. Select a model for this session's runtime.",
          });
        const config = yield* deps.settings.getRepoConfigByRepoPath(target.repoPath);
        const catalog = yield* catalogFor(target);
        const current = saved ? resolveSavedModelAlias(catalog, saved) : null;
        const decision = resolveSavedSessionModel({
          runtimeKind: target.runtimeKind,
          savedSelection: saved,
          defaultSelection:
            target.sessionScope.kind === "workflow"
              ? (config.agentDefaults[target.sessionScope.role] ?? config.defaultModel ?? null)
              : (config.defaultModel ?? null),
          catalog,
        });
        if (decision.kind === "blocked")
          return yield* new HostValidationError({
            field: decision.reason,
            message: decision.message,
          });
        if (!isSameSelection(current, decision.selection))
          return yield* new HostValidationError({
            field: "model",
            message:
              "The selected session settings are no longer permitted. Select a supported model in session settings.",
          });
        if (previous !== undefined && current) {
          const model = findCatalogModel(catalog, current);
          const policy = resolveModelSelectionPolicy(model, true);
          if (!policy.canChangeProfile && current.profileId !== previous?.profileId)
            return yield* new HostValidationError({
              field: "profile",
              message:
                "This runtime cannot change the profile of a live session. Start a new session with the required profile.",
            });
          if (
            current.variant !== previous?.variant &&
            current.variant &&
            !policy.variants.includes(current.variant)
          )
            return yield* new HostValidationError({
              field: "model",
              message:
                "This runtime cannot apply this variant to a live session. Select a permitted variant or start a new session.",
            });
        }
        return decision.selection;
      }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-model"))),
  };
};
