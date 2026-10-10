import type { TaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import type {
  AgentSessionLiveReadResult,
  AgentSessionModelSelection,
  AgentSessionLiveRef,
  AgentSessionRecord,
  AgentRole,
  AutopilotActionId,
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
  type SessionLaunchAction,
  resolvePullRequestTarget,
} from "@openducktor/core";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { errorMessage, HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
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
import { findWorkflowSession } from "./task-workflow-session-storage";

/** A reuse decision carries the owned source record and its live state, read once. */
export type PreparedWorkflowDecision =
  | Exclude<WorkflowLaunchDecision, { startMode: "reuse" }>
  | (Extract<WorkflowLaunchDecision, { startMode: "reuse" }> & {
      source: AgentSessionRecord;
      live: AgentSessionLiveReadResult;
    });

export type WorkflowLaunchPreparationDependencies = {
  resolveParts: (
    parts: Parameters<typeof resolveSessionMessageParts>[0],
  ) => ReturnType<typeof resolveSessionMessageParts>;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "getSettingsSnapshot">;
  tasks: Pick<
    TaskService,
    "agentSessionsList" | "agentSessionUpdateModel" | "humanRequestChanges" | "updateTask"
  >;
  taskReader: Pick<TaskStorePort, "getTask">;
  worktrees: Pick<TaskWorktreeService, "getTaskWorktree">;
  startPreparation: Pick<TaskSessionStartPreparationService, "validateTarget">;
  git: Pick<GitPort, "canonicalizePath">;
  definitions: RuntimeDefinitionsService;
  registry: Pick<RuntimeRegistryPort, "requireReady">;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog">;
  provider: Pick<GitProviderService, "getContext">;
  runtime: Pick<SessionLaunchRuntimePort, "read">;
};

export const prepareWorkflowLaunch = (
  deps: WorkflowLaunchPreparationDependencies,
  request: WorkflowLaunchRequest,
  repoPath: string,
  config: RepoConfig,
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
    // Validate input before any task mutation or runtime creation.
    const messageParts =
      request.instruction.kind === "message"
        ? yield* deps.resolveParts(request.instruction.parts)
        : undefined;
    const feedback =
      request.instruction.kind === "kickoff" ? request.instruction.feedback?.trim() : undefined;
    if (request.instruction.kind === "kickoff") {
      if (request.instruction.text !== undefined && !request.instruction.text.trim())
        return yield* launchValidationError("Kickoff prompt must not be blank.");
      if (actionId === "build_after_human_request_changes" && !feedback)
        return yield* launchValidationError("Feedback message is required before sending.");
      if (!action.kickoffTemplateId)
        return yield* launchValidationError(
          `Action '${actionId}' does not define a kickoff prompt.`,
        );
    }
    if (request.beforeStartAction && actionId !== "build_after_human_request_changes")
      return yield* launchValidationError(
        "Human request changes requires the Apply Human Changes action.",
      );
    const targetBranch = request.targetBranch ?? task.targetBranch ?? config.defaultTargetBranch;
    if (actionId === "build_pull_request_generation") {
      const unavailable = yield* pullRequestUnavailableReason(deps, repoPath);
      if (unavailable) {
        if (request.policy.kind === "automatic")
          return { kind: "skipped" as const, reason: unavailable };
        return yield* launchValidationError(unavailable);
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
    const kickoffText = (task: TaskCard) =>
      Effect.try({
        try: () =>
          request.instruction.kind === "kickoff" && request.instruction.text !== undefined
            ? request.instruction.text
            : buildAgentKickoffPrompt({
                role: action.role,
                templateId: action.kickoffTemplateId!,
                task: toPromptTask(task),
                overrides,
                ...kickoffContext,
              }),
        catch: (cause) => toHostOperationError(cause, "workflow-launch.instruction"),
      });
    if (request.instruction.kind === "kickoff" && !(yield* kickoffText(task)).trim())
      return yield* launchValidationError("Kickoff prompt must not be blank.");
    const resolved =
      request.policy.kind === "manual"
        ? { kind: "decided" as const, decision: request.policy.decision }
        : yield* decideAutomaticLaunch(deps, {
            request,
            actionId: request.policy.actionId,
            repoPath,
            config,
            action,
            alwaysStartQaReviewsFresh: settings.autopilot.alwaysStartQaReviewsFresh,
          });
    if (resolved.kind === "skipped") return resolved;
    const decision = resolved.decision;
    if (!action.allowedStartModes.includes(decision.startMode))
      return yield* launchValidationError(
        `Action '${actionId}' does not permit '${decision.startMode}'.`,
      );
    if (decision.startMode === "reuse") onReuse({ repoPath, ...decision.sourceSession });
    if (decision.startMode === "fresh" && decision.targetWorkingDirectory)
      yield* deps.startPreparation.validateTarget({
        canonicalRepoPath: repoPath,
        taskId: request.taskId,
        role: action.role,
        runtimeKind: decision.selectedModel.runtimeKind,
        targetWorkingDirectory: decision.targetWorkingDirectory,
      });
    let model: AgentSessionModelSelection | undefined;
    let prepared: PreparedWorkflowDecision;
    if (decision.startMode === "fresh") {
      model = decision.selectedModel;
      prepared = decision;
    } else {
      const source = decision.sourceSession;
      const records = yield* deps.tasks.agentSessionsList({ repoPath, taskId: request.taskId });
      const stored = findWorkflowSession(records, action.role, source);
      if (!stored)
        return yield* launchValidationError(
          `Task '${request.taskId}' does not own the selected ${action.role} source '${source.externalSessionId}'.`,
        );
      if (decision.startMode === "fork") {
        const sourcePath = yield* deps.git.canonicalizePath(source.workingDirectory);
        if (normalizePathForComparison(sourcePath) === normalizePathForComparison(repoPath))
          return yield* launchValidationError(
            "Legacy repository-root task sessions cannot be forked. Start a fresh Builder in the task worktree.",
          );
        if (decision.selectedModel.runtimeKind !== source.runtimeKind)
          return yield* launchValidationError(
            "Fork model must use the source runtime. Select a model from that runtime.",
          );
        model = decision.selectedModel;
        prepared = decision;
      } else {
        const live = yield* deps.runtime.read({ repoPath, ...source });
        if (
          live.type === "live" &&
          (live.session.pendingApprovals.length > 0 ||
            live.session.pendingQuestions.some((question) => question.blocking !== false))
        )
          return yield* launchValidationError(
            "The selected session is waiting for an approval or question. Answer or reject it before sending a message.",
          );
        model = stored.selectedModel ?? undefined;
        if (decision.speed !== undefined) {
          if (!model)
            return yield* launchValidationError(
              "The source session has no model. Select a model before you change its speed.",
            );
          model = withSpeed(model, decision.speed);
        }
        prepared = { ...decision, source: stored, live };
      }
    }
    const runtimeKind =
      decision.startMode === "reuse"
        ? decision.sourceSession.runtimeKind
        : decision.selectedModel.runtimeKind;
    const descriptor = yield* resolveRuntimeDescriptorForTaskSession(
      deps.definitions,
      runtimeKind,
      action.role,
    );
    if (!descriptor.capabilities.sessionLifecycle.supportedStartModes.includes(decision.startMode))
      return yield* launchValidationError(
        `Runtime '${runtimeKind}' does not support '${decision.startMode}'. Select a supported launch mode.`,
      );
    yield* deps.registry.requireReady(runtimeKind);
    if (request.beforeStartAction) {
      yield* deps.tasks.humanRequestChanges({
        repoPath,
        taskId: request.taskId,
        note: request.beforeStartAction.note,
      });
    }
    if (request.targetBranch) {
      yield* deps.tasks.updateTask({
        repoPath,
        taskId: request.taskId,
        patch: { targetBranch: request.targetBranch },
      });
    }
    task = yield* deps.taskReader.getTask({ repoPath, taskId: request.taskId });
    yield* validateTaskSessionWorkflowAvailable(task, action.role, repoPath);
    const systemPrompt = buildAgentSystemPrompt({
      role: action.role,
      task: toPromptTask(task),
      overrides,
    });
    const parts =
      request.instruction.kind === "kickoff"
        ? [{ kind: "text" as const, text: yield* kickoffText(task) }]
        : messageParts;
    return {
      kind: "prepared" as const,
      action,
      decision: prepared,
      model,
      systemPrompt,
      parts,
    };
  });

const launchValidationError = (message: string) =>
  new HostValidationError({ field: "workflowLaunch", message });
export const workflowActionId = (request: WorkflowLaunchRequest): SessionLaunchActionId =>
  request.policy.kind === "manual"
    ? request.policy.actionId
    : AUTOPILOT_ACTION_DEFINITIONS[request.policy.actionId].launchActionId;

export const resolveLaunchWorkspace = (
  deps: Pick<WorkflowLaunchPreparationDependencies, "settings" | "git">,
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

/** Autopilot applies the same start rules as the manual start modal. */
const decideAutomaticLaunch = (
  deps: WorkflowLaunchPreparationDependencies,
  {
    request,
    actionId,
    repoPath,
    config,
    action,
    alwaysStartQaReviewsFresh,
  }: {
    request: WorkflowLaunchRequest;
    actionId: AutopilotActionId;
    repoPath: string;
    config: RepoConfig;
    action: SessionLaunchAction;
    alwaysStartQaReviewsFresh: boolean;
  },
) =>
  Effect.gen(function* () {
    const automatic = AUTOPILOT_ACTION_DEFINITIONS[actionId];
    const { role, allowedStartModes } = action;
    const records = yield* deps.tasks.agentSessionsList({ repoPath, taskId: request.taskId });
    const latest = records
      .filter((record) => record.role === role)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    const sourceSession = latest && {
      externalSessionId: latest.externalSessionId,
      runtimeKind: latest.runtimeKind,
      workingDirectory: latest.workingDirectory,
    };
    const configuredModel = () =>
      resolveConfiguredDefaultModel(deps, repoPath, config, role, request.workspaceId);
    if (automatic.startPolicy.kind === "latestRoleSession") {
      if (!sourceSession)
        return {
          kind: "skipped" as const,
          reason: `No ${role} session is available to fork for task '${request.taskId}'.`,
        };
      const decision: WorkflowLaunchDecision = {
        startMode: "fork",
        sourceSession,
        // A fork starts at standard speed.
        selectedModel: latest.selectedModel
          ? withSpeed(latest.selectedModel, null)
          : yield* configuredModel(),
      };
      return { kind: "decided" as const, decision };
    }
    const forceFreshQa = automatic.id === "startQa" && alwaysStartQaReviewsFresh;
    const continuation = allowedStartModes.includes("reuse")
      ? yield* deps.worktrees.getTaskWorktree({ repoPath, taskId: request.taskId })
      : null;
    if (allowedStartModes.includes("reuse") && !continuation && role !== "qa")
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
    ) {
      const decision: WorkflowLaunchDecision = { startMode: "reuse", sourceSession };
      return { kind: "decided" as const, decision };
    }
    const decision: WorkflowLaunchDecision = {
      startMode: "fresh",
      selectedModel: yield* configuredModel(),
    };
    return { kind: "decided" as const, decision };
  });

/** Checks the configured default against the runtime catalog and fills its default variant. */
const resolveConfiguredDefaultModel = (
  deps: WorkflowLaunchPreparationDependencies,
  repoPath: string,
  config: RepoConfig,
  role: AgentRole,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const configured = config.agentDefaults[role] ?? config.defaultModel;
    if (!configured)
      return yield* launchValidationError(
        `Configure the ${role} role default or repository default model in workspace '${workspaceId}'.`,
      );
    const runtimeKind = configured.runtimeKind;
    const { models } = yield* deps.queries.loadRuntimeCatalog({
      repoPath,
      runtimeKind,
      workingDirectory: repoPath,
    });
    if (models?.status !== "available")
      return yield* launchValidationError(
        `The ${role} default model for runtime ${runtimeKind} could not load: ${models?.status === "failed" ? models.message : "the runtime returned no model catalog."} Update the default in repository settings.`,
      );
    const entry = models.catalog.models.find(
      (item) => item.providerId === configured.providerId && item.modelId === configured.modelId,
    );
    const profiles = models.catalog.profiles ?? [];
    const profileAvailable =
      configured.profileId === undefined ||
      profiles.length === 0 ||
      profiles.some(
        (profile) =>
          (profile.id ?? profile.name) === configured.profileId &&
          !profile.hidden &&
          profile.mode !== "subagent",
      );
    if (
      !entry ||
      (configured.variant !== undefined && !entry.variants.includes(configured.variant)) ||
      !profileAvailable
    )
      return yield* launchValidationError(
        `The ${role} default model '${configured.providerId}/${configured.modelId}' is not available for runtime ${runtimeKind}. Update the default in repository settings.`,
      );
    const model: AgentSessionModelSelection = { ...configured };
    const variant = configured.variant ?? entry.variants[0];
    if (variant) model.variant = variant;
    return model;
  });

/**
 * Returns why Pull Request generation cannot run, or null. A provider read failure becomes the
 * reason, so Autopilot skips the launch and a manual launch shows the reason.
 */
const pullRequestUnavailableReason = (
  deps: Pick<WorkflowLaunchPreparationDependencies, "provider">,
  repoPath: string,
) =>
  deps.provider.getContext(repoPath).pipe(
    Effect.map((context) => {
      if (!context?.descriptor.capabilities.supportsPullRequests)
        return "The current Git provider does not support Pull Requests.";
      if (!context.health.available)
        return (
          context.health.reason ?? `${context.descriptor.label} is not available for Pull Requests.`
        );
      return null;
    }),
    Effect.catch((cause) =>
      Effect.succeed(`Could not load the current Git provider: ${errorMessage(cause)}`),
    ),
  );

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
