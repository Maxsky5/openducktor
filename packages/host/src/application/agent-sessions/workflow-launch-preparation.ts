import type { TaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import { TaskMutationCommittedError } from "../tasks/task-mutation-committed-error";
import type {
  AgentSessionModelSelection,
  AgentSessionLiveRef,
  AgentRole,
  RuntimeKind,
  RepoConfig,
  TaskCard,
  WorkflowLaunchDecision,
  WorkflowLaunchRequest,
  SessionLaunchActionId,
} from "@openducktor/contracts";
import {
  AUTOPILOT_ACTION_DEFINITIONS,
  buildAgentKickoffPrompt,
  buildAgentSystemPrompt,
  getSessionLaunchAction,
  mergePromptOverrides,
  resolvePullRequestTarget,
} from "@openducktor/core";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../tasks/worktrees/task-worktree-service";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type { TaskService } from "../tasks/task-service";
import type { GitProviderService } from "../git/git-provider-service";
import type { resolveSessionMessageParts } from "../attachments/resolve-session-message-parts";
import { validateTaskSessionWorkflowAvailable } from "../tasks/support/task-session-workflow-validation";
import { resolveRuntimeDescriptorForTaskSession } from "../tasks/support/task-worktree-cleanup";
import { validateExistingGitTaskWorktree } from "../tasks/support/task-worktree-start";
import { findWorkflowSession } from "./task-workflow-session-storage";

export type WorkflowLaunchPreparationDependencies = {
  resolveParts: (
    parts: Parameters<typeof resolveSessionMessageParts>[0],
  ) => ReturnType<typeof resolveSessionMessageParts>;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "getSettingsSnapshot">;
  tasks: Pick<TaskService, "agentSessionsList" | "humanRequestChanges" | "updateTask">;
  taskReader: Pick<TaskStorePort, "getTask">;
  worktrees: TaskWorktreeService;
  startPreparation: Pick<TaskSessionStartPreparationService, "validateTarget">;
  git: GitPort;
  definitions: RuntimeDefinitionsService;
  registry: Pick<RuntimeRegistryPort, "requireReady">;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog">;
  provider: Pick<GitProviderService, "getContext">;
};
export const prepareWorkflowLaunch = (
  deps: WorkflowLaunchPreparationDependencies,
  request: WorkflowLaunchRequest,
  repoPath: string,
  config: RepoConfig,
  onCommit: (action: "human_request_changes" | "target_branch") => void,
  onReuse: (source: AgentSessionLiveRef) => void,
) =>
  Effect.gen(function* () {
    const actionId = workflowActionId(request);
    const action = getSessionLaunchAction(actionId);
    let task = yield* deps.taskReader.getTask({ repoPath, taskId: request.taskId });
    yield* validateTaskSessionWorkflowAvailable(task, action.role, repoPath);
    const settings = yield* deps.settings.getSettingsSnapshot();
    const overrides = mergePromptOverrides({
      globalOverrides: settings.globalPromptOverrides,
      repoOverrides: config.promptOverrides,
    });
    const messageParts =
      request.instruction.kind === "message"
        ? yield* deps.resolveParts(request.instruction.parts)
        : undefined;
    // Validate input before any task mutation or runtime creation.
    if (
      request.instruction.kind === "kickoff" &&
      request.instruction.text !== undefined &&
      !request.instruction.text.trim()
    )
      return yield* launchValidationError(
        request.instruction.kind === "kickoff"
          ? "Kickoff prompt must not be blank."
          : "Feedback message is required before sending.",
      );
    const feedback =
      request.instruction.kind === "kickoff" ? request.instruction.feedback?.trim() : undefined;
    if (
      actionId === "build_after_human_request_changes" &&
      request.instruction.kind === "kickoff" &&
      !feedback
    )
      return yield* launchValidationError("Feedback message is required before sending.");
    if (request.instruction.kind === "kickoff" && !action.kickoffTemplateId)
      return yield* launchValidationError(`Action '${actionId}' does not define a kickoff prompt.`);
    if (request.beforeStartAction && actionId !== "build_after_human_request_changes")
      return yield* launchValidationError(
        "Human request changes requires the Apply Human Changes action.",
      );
    const targetBranch = request.targetBranch ?? task.targetBranch ?? config.defaultTargetBranch;
    if (actionId === "build_pull_request_generation") {
      const context = yield* deps.provider.getContext(repoPath);
      const reason = !context?.descriptor.capabilities.supportsPullRequests
        ? "The current Git provider does not support Pull Requests."
        : !context.config.enabled || !context.health.available
          ? (context.health.reason ??
            "The Git provider is unavailable. Check repository provider settings.")
          : null;
      if (reason) {
        if (request.policy.kind === "automatic") return { kind: "skipped" as const, reason };
        return yield* launchValidationError(reason);
      }
      yield* Effect.try({
        try: () => resolvePullRequestTarget(targetBranch),
        catch: (cause) => toHostOperationError(cause, "workflow-launch.pull-request-target"),
      });
    }
    const kickoffContext: Pick<
      Parameters<typeof buildAgentKickoffPrompt>[0],
      "extraPlaceholders" | "git"
    > = {};
    if (feedback) kickoffContext.extraPlaceholders = { humanFeedback: feedback };
    if (actionId === "build_pull_request_generation") kickoffContext.git = { targetBranch };
    if (request.instruction.kind === "kickoff") {
      const preview = yield* Effect.try({
        try: () =>
          request.instruction.kind === "kickoff"
            ? (request.instruction.text ??
              buildAgentKickoffPrompt({
                role: action.role,
                templateId: action.kickoffTemplateId!,
                task: toPromptTask(task),
                overrides,
                ...kickoffContext,
              }))
            : "",
        catch: (cause) => toHostOperationError(cause, "workflow-launch.instruction"),
      });
      if (!preview.trim()) return yield* launchValidationError("Kickoff prompt must not be blank.");
    }
    let decision: WorkflowLaunchDecision;
    if (request.policy.kind === "manual") decision = request.policy.decision;
    else {
      const automatic = AUTOPILOT_ACTION_DEFINITIONS[request.policy.actionId];
      const forceFreshQa =
        automatic.id === "startQa" && settings.autopilot.alwaysStartQaReviewsFresh;
      const records = yield* deps.tasks.agentSessionsList({ repoPath, taskId: request.taskId });
      const latest = records
        .filter((record) => record.role === action.role)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      const selectedModel = latest?.selectedModel;
      const defaultModel = config.agentDefaults[action.role] ?? config.defaultModel;
      const requireModel = (): AgentSessionModelSelection => {
        // A fork starts at standard speed.
        const model =
          automatic.id === "startGeneratePullRequest" && selectedModel
            ? withSpeed(selectedModel, null)
            : defaultModel;
        if (!model)
          throw launchValidationError(
            `Configure the ${action.role} role default or repository default model in workspace '${request.workspaceId}'.`,
          );
        return model;
      };
      const sourceSession = latest
        ? {
            externalSessionId: latest.externalSessionId,
            runtimeKind: latest.runtimeKind,
            workingDirectory: latest.workingDirectory,
          }
        : null;
      if (automatic.startPolicy.kind === "latestRoleSession") {
        if (!sourceSession)
          return {
            kind: "skipped" as const,
            reason: `No ${action.role} session is available to fork for task '${request.taskId}'.`,
          };
        decision = {
          startMode: "fork",
          sourceSession,
          selectedModel: yield* Effect.try({
            try: requireModel,
            catch: (cause) => toHostOperationError(cause, "workflow-launch.default-model"),
          }),
        };
      } else {
        const continuation = action.allowedStartModes.includes("reuse")
          ? yield* deps.worktrees.getTaskWorktree({ repoPath, taskId: request.taskId })
          : null;
        if (action.allowedStartModes.includes("reuse") && !continuation && action.role !== "qa")
          return {
            kind: "skipped" as const,
            reason: `Builder continuation cannot start until a task worktree exists for task ${request.taskId}.`,
          };
        if (
          !forceFreshQa &&
          continuation &&
          sourceSession &&
          normalizePathForComparison(sourceSession.workingDirectory) ===
            normalizePathForComparison(continuation.workingDirectory)
        )
          decision = { startMode: "reuse", sourceSession };
        else
          decision = {
            startMode: "fresh",
            selectedModel: yield* Effect.try({
              try: requireModel,
              catch: (cause) => toHostOperationError(cause, "workflow-launch.default-model"),
            }),
          };
      }
    }
    if (decision.startMode === "reuse") onReuse({ repoPath, ...decision.sourceSession });
    if (request.targetWorkingDirectory) {
      if (decision.startMode !== "fresh")
        return yield* launchValidationError(
          "An explicit working directory is only valid for a fresh workflow launch.",
        );
      yield* deps.startPreparation.validateTarget({
        canonicalRepoPath: repoPath,
        taskId: request.taskId,
        role: action.role,
        runtimeKind: decision.selectedModel.runtimeKind,
        targetWorkingDirectory: request.targetWorkingDirectory,
      });
    }
    if (!action.allowedStartModes.includes(decision.startMode))
      return yield* launchValidationError(
        `Action '${actionId}' does not permit '${decision.startMode}'.`,
      );
    let model: AgentSessionModelSelection | undefined;
    if (decision.startMode !== "fresh") {
      const source = decision.sourceSession;
      const records = yield* deps.tasks.agentSessionsList({ repoPath, taskId: request.taskId });
      const stored = findWorkflowSession(records, action.role, source);
      if (!stored)
        return yield* launchValidationError(
          `Task '${request.taskId}' does not own the selected ${action.role} source '${source.externalSessionId}'.`,
        );
      const sourcePath = yield* deps.git.canonicalizePath(source.workingDirectory);
      if (normalizePathForComparison(sourcePath) === normalizePathForComparison(repoPath)) {
        if (decision.startMode === "fork")
          return yield* launchValidationError(
            "Legacy repository-root task sessions cannot be forked. Start a fresh Builder in the task worktree.",
          );
      } else
        yield* validateExistingGitTaskWorktree(
          { gitPort: deps.git },
          repoPath,
          source.workingDirectory,
          task.id,
        );
      if (decision.startMode === "reuse") {
        model = stored.selectedModel ?? undefined;
        if (decision.speed !== undefined) {
          if (!model)
            return yield* launchValidationError(
              "The source session has no model. Select a model before you change its speed.",
            );
          model = withSpeed(model, decision.speed);
        }
      } else model = decision.selectedModel;
      if (model && model.runtimeKind !== source.runtimeKind)
        return yield* launchValidationError(
          "Fork model must use the source runtime. Select a model from that runtime.",
        );
    } else model = decision.selectedModel;
    const runtimeKind =
      decision.startMode === "fresh"
        ? decision.selectedModel.runtimeKind
        : decision.sourceSession.runtimeKind;
    yield* validateWorkflowRuntimeSelection(
      deps,
      { repoPath, runtimeKind, role: action.role, startMode: decision.startMode },
      model,
    );
    if (request.beforeStartAction) {
      yield* deps.tasks
        .humanRequestChanges({
          repoPath,
          taskId: request.taskId,
          note: request.beforeStartAction.note,
        })
        .pipe(
          Effect.tapError((cause) =>
            cause instanceof TaskMutationCommittedError
              ? Effect.sync(() => onCommit("human_request_changes"))
              : Effect.void,
          ),
        );
      onCommit("human_request_changes");
    }
    if (request.targetBranch) {
      yield* deps.tasks
        .updateTask({
          repoPath,
          taskId: request.taskId,
          patch: { targetBranch: request.targetBranch },
        })
        .pipe(
          Effect.tapError((cause) =>
            cause instanceof TaskMutationCommittedError
              ? Effect.sync(() => onCommit("target_branch"))
              : Effect.void,
          ),
        );
      onCommit("target_branch");
    }
    task = yield* deps.taskReader.getTask({ repoPath, taskId: request.taskId });
    yield* validateTaskSessionWorkflowAvailable(task, action.role, repoPath);
    const taskContext = toPromptTask(task);
    const systemPrompt = buildAgentSystemPrompt({
      role: action.role,
      task: taskContext,
      overrides,
    });
    let parts = messageParts;
    if (request.instruction.kind === "kickoff") {
      if (!action.kickoffTemplateId)
        return yield* launchValidationError(
          `Action '${actionId}' does not define a kickoff prompt.`,
        );
      const text =
        request.instruction.text ??
        buildAgentKickoffPrompt({
          role: action.role,
          templateId: action.kickoffTemplateId,
          task: taskContext,
          overrides,
          ...kickoffContext,
        });
      parts = [{ kind: "text", text }];
    }
    return { kind: "prepared" as const, action, decision, model, systemPrompt, parts };
  });

export const launchValidationError = (message: string) =>
  new HostValidationError({ field: "workflowLaunch", message });
export const workflowActionId = (request: WorkflowLaunchRequest): SessionLaunchActionId =>
  request.policy.kind === "manual"
    ? request.policy.actionId
    : AUTOPILOT_ACTION_DEFINITIONS[request.policy.actionId].launchActionId;

export const resolveLaunchWorkspace = (
  deps: WorkflowLaunchPreparationDependencies,
  request: Pick<WorkflowLaunchRequest, "workspaceId" | "repoPath">,
) =>
  Effect.gen(function* () {
    const config = yield* deps.settings.getRepoConfig(request.workspaceId);
    const repoPath = yield* deps.git.canonicalizePath(config.repoPath);
    const asserted = yield* deps.git.canonicalizePath(request.repoPath);
    if (normalizePathForComparison(repoPath) !== normalizePathForComparison(asserted))
      return yield* launchValidationError(
        `Workspace '${request.workspaceId}' belongs to '${repoPath}', not '${request.repoPath}'.`,
      );
    return { config, repoPath };
  });

export const validateWorkflowRuntimeSelection = (
  deps: WorkflowLaunchPreparationDependencies,
  {
    repoPath,
    runtimeKind,
    role,
    startMode,
  }: {
    repoPath: string;
    runtimeKind: RuntimeKind;
    role: AgentRole;
    startMode: WorkflowLaunchDecision["startMode"];
  },
  model?: AgentSessionModelSelection,
) =>
  Effect.gen(function* () {
    const descriptor = yield* resolveRuntimeDescriptorForTaskSession(
      deps.definitions,
      runtimeKind,
      role,
    );
    if (!descriptor.capabilities.sessionLifecycle.supportedStartModes.includes(startMode))
      return yield* launchValidationError(
        `Runtime '${runtimeKind}' does not support '${startMode}'. Select a supported launch mode.`,
      );
    yield* deps.registry.requireReady(runtimeKind);
    if (model) {
      const { models } = yield* deps.queries.loadRuntimeCatalog({
        repoPath,
        runtimeKind,
        workingDirectory: repoPath,
      });
      if (models?.status !== "available")
        return yield* launchValidationError(
          `Cannot validate ${runtimeKind} model: ${models?.status === "failed" ? models.message : "Runtime returned no model catalog."} Check the runtime and model settings.`,
        );
      const entry = models.catalog.models.find(
        (item) => item.providerId === model.providerId && item.modelId === model.modelId,
      );
      if (!entry || (model.variant !== undefined && !entry.variants.includes(model.variant)))
        return yield* launchValidationError(
          `Model '${model.providerId}/${model.modelId}' or variant '${model.variant ?? ""}' is unavailable on '${runtimeKind}'. Correct the selected or configured model.`,
        );
      if (model.speed !== undefined && !entry.speedLevels?.some(({ id }) => id === model.speed))
        return yield* launchValidationError(
          `Speed '${model.speed}' is unavailable for model '${model.providerId}/${model.modelId}'. Select a supported speed.`,
        );
      if (
        model.profileId !== undefined &&
        !models.catalog.profiles?.some(
          (profile) =>
            (profile.id ?? profile.name) === model.profileId &&
            !profile.hidden &&
            profile.mode !== "subagent",
        )
      )
        return yield* launchValidationError(
          `Profile '${model.profileId}' is unavailable on '${runtimeKind}'. Correct the selected or configured profile.`,
        );
    }
  });

const withSpeed = (
  model: AgentSessionModelSelection,
  speed: string | null,
): AgentSessionModelSelection => {
  const { speed: _speed, ...selection } = model;
  return speed === null ? selection : { ...selection, speed };
};

const toPromptTask = (task: TaskCard) => ({
  taskId: task.id,
  title: task.title,
  issueType: task.issueType,
  status: task.status,
  qaRequired: task.aiReviewEnabled,
  description: task.description,
});
