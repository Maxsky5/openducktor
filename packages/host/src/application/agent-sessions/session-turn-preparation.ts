import type {
  AgentMessageTarget,
  AgentSessionModelSelection,
  RepoPromptOverrides,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import {
  resolveSavedSessionModel,
  isSameSelection,
  resolveModelSelectionPolicy,
  findCatalogModel,
  resolveSavedModelAlias,
} from "@openducktor/core";
import { Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";

type PreparationTarget = Omit<AgentMessageTarget, "externalSessionId">;

export const createSessionTurnPreparation = (deps: {
  settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath" | "getSettingsSnapshot">;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog">;
  taskReader: Pick<TaskStorePort, "getTask">;
  taskWorkflows: TaskWorkflowResolver;
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
  const overridesFor = (repoPath: string, workflow: TaskWorkflow) =>
    Effect.gen(function* () {
      const config = yield* deps.settings.getRepoConfigByRepoPath(repoPath);
      const settings = yield* deps.settings.getSettingsSnapshot();
      return workflow.prompts.mergeOverrides({
        globalOverrides: settings.globalPromptOverrides,
        repoOverrides: config.promptOverrides,
      });
    });
  return {
    /** The task workflow of the task of a workflow session. */
    taskWorkflow: (repoPath: string, taskId: string): Effect.Effect<TaskWorkflow, HostError> =>
      deps.taskReader.getTask({ repoPath, taskId }).pipe(
        Effect.map((task) => deps.taskWorkflows.forTask(task)),
        Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-context")),
      ),
    promptOverrides: (
      repoPath: string,
      workflow: TaskWorkflow,
    ): Effect.Effect<RepoPromptOverrides, HostError> =>
      overridesFor(repoPath, workflow).pipe(
        Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-context")),
      ),
    context: (target: PreparationTarget) =>
      Effect.gen(function* () {
        if (target.sessionScope.kind === "repository") return undefined;
        const task = yield* deps.taskReader.getTask({
          repoPath: target.repoPath,
          taskId: target.sessionScope.taskId,
        });
        const workflow = deps.taskWorkflows.forTask(task);
        const overrides = yield* overridesFor(target.repoPath, workflow);
        const overrideProblem = workflow.prompts.findOverrideProblem(overrides);
        if (overrideProblem !== undefined) {
          return yield* new HostValidationError({
            field: "promptOverrides",
            message: overrideProblem,
          });
        }
        return workflow.prompts.systemPrompt({
          role: target.sessionScope.role,
          task: {
            taskId: task.id,
            title: task.title,
            issueType: task.issueType,
            status: task.status,
            description: task.description,
          },
          overrides,
        }).prompt;
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
