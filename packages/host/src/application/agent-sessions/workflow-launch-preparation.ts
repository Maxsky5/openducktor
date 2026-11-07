import type {
  AgentSessionModelSelection,
  AgentSessionLiveRef,
  RepoConfig,
  WorkflowLaunchDecision,
  WorkflowLaunchRequest,
} from "@openducktor/contracts";
import type {
  WorkflowLaunchAttemptRequest,
  PreparedWorkflowDecision,
  WorkflowLaunchPreparationDependencies,
} from "./workflow-launch-types";
import {
  isPullRequestLaunch,
  requirePullRequestTarget,
  type TaskFacts,
  type TaskWorkflow,
  type TaskWorkflowLaunchAction,
} from "@openducktor/workflows";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { errorMessage, HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { TaskRecord } from "../../ports/task-repository-ports";
import { validateTaskSessionWorkflowAvailable } from "../tasks/support/task-session-workflow-validation";
import { resolveRuntimeDescriptorForTaskSession } from "../tasks/support/task-worktree-cleanup";
import { findWorkflowSession } from "./task-workflow-session-storage";
import {
  decideAutomaticLaunch,
  launchValidationError,
  resolveAutomaticLaunch,
  withSpeed,
} from "./workflow-automatic-launch";

export const prepareWorkflowLaunch = (
  deps: WorkflowLaunchPreparationDependencies,
  request: WorkflowLaunchAttemptRequest,
  repoPath: string,
  config: RepoConfig,
  onReuse: (source: AgentSessionLiveRef) => void,
) =>
  Effect.gen(function* () {
    let task = yield* deps.taskReader.getTask({
      workspaceId: request.workspaceId,
      repoPath,
      taskId: request.taskId,
    });
    const workflow = deps.taskWorkflows.forTask(task);
    const launch =
      request.policy.kind === "manual"
        ? {
            kind: "resolved" as const,
            action: yield* requireLaunchAction(workflow, { policy: request.policy }),
            latest: undefined,
          }
        : yield* resolveAutomaticLaunch(deps, workflow, request, request.policy.actionId, repoPath);
    if (launch.kind === "skipped") return launch;
    const { action } = launch;
    const actionId = action.id;
    const roleLabel = workflow.role(action.role).label;
    if (request.beforeStartAction && action.context !== "human_feedback")
      return yield* launchValidationError(
        `Action '${actionId}' collects no human feedback, so it cannot commit event '${request.beforeStartAction.eventId}' before its start. Start the launch without that event.`,
      );
    // A launch that follows an event runs in the state that the event gives. The event must be
    // allowed now; the host commits it below, after runtime admission.
    const beforeStartEventId = request.beforeStartAction?.eventId;
    const launchTask =
      beforeStartEventId === undefined
        ? task
        : yield* Effect.try({
            try: () => workflow.taskAfterEvent(beforeStartEventId, task),
            catch: (cause) => launchValidationError(errorMessage(cause)),
          });
    yield* validateLaunchAvailable(workflow, launchTask, action, repoPath);
    const settings = yield* deps.settingsConfig.readGlobalConfig();
    const overrides = workflow.prompts.mergeOverrides({
      globalOverrides: settings.globalPromptOverrides,
      repoOverrides: config.promptOverrides,
    });
    // Validate input before any task mutation or runtime creation.
    const overrideProblem = workflow.prompts.findOverrideProblem(overrides);
    if (overrideProblem !== undefined) return yield* launchValidationError(overrideProblem);
    const messageParts =
      request.instruction.kind === "message"
        ? yield* deps.resolveParts(request.instruction.parts)
        : undefined;
    const feedback =
      request.instruction.kind === "kickoff" ? request.instruction.feedback?.trim() : undefined;
    const kickoffTemplateId = action.template.kind === "kickoff" ? action.template.id : undefined;
    if (request.instruction.kind === "kickoff") {
      if (request.instruction.text !== undefined && !request.instruction.text.trim())
        return yield* launchValidationError("Kickoff prompt must not be blank.");
      if (action.context === "human_feedback" && !feedback)
        return yield* launchValidationError("Feedback message is required before sending.");
      if (kickoffTemplateId === undefined)
        return yield* launchValidationError(
          `Action '${actionId}' does not define a kickoff prompt.`,
        );
    }
    const targetBranch = request.targetBranch ?? task.targetBranch ?? config.defaultTargetBranch;
    if (isPullRequestLaunch(action.id)) {
      const unavailable = yield* pullRequestUnavailableReason(deps, {
        workspaceId: config.workspaceId,
        repoPath,
      });
      if (unavailable) {
        if (request.policy.kind === "automatic")
          return { kind: "skipped" as const, reason: unavailable };
        return yield* launchValidationError(unavailable);
      }
      yield* Effect.try({
        try: () => requirePullRequestTarget(action.template.id, targetBranch),
        catch: (cause) => toHostOperationError(cause, "workflow-launch.pull-request-target"),
      });
    }
    const kickoffText = (task: TaskRecord) =>
      Effect.try({
        try: () =>
          request.instruction.kind === "kickoff" && request.instruction.text !== undefined
            ? request.instruction.text
            : workflow.prompts.kickoffPrompt({
                launchActionId: action.id,
                role: action.role,
                task: toPromptTask(task),
                humanFeedback: feedback || undefined,
                targetBranch: isPullRequestLaunch(action.id) ? targetBranch : undefined,
                overrides,
              }).prompt,
        catch: (cause) => toHostOperationError(cause, "workflow-launch.instruction"),
      });
    if (request.instruction.kind === "kickoff" && !(yield* kickoffText(task)).trim())
      return yield* launchValidationError("Kickoff prompt must not be blank.");
    const resolved =
      request.policy.kind === "manual"
        ? { kind: "decided" as const, decision: request.policy.decision }
        : yield* decideAutomaticLaunch(deps, {
            request,
            workflow,
            actionId: request.policy.actionId,
            repoPath,
            config,
            action,
            latest: launch.latest,
            alwaysStartQaReviewsFresh: settings.autopilot.alwaysStartQaReviewsFresh,
          });
    if (resolved.kind === "skipped") return resolved;
    const decision = resolved.decision;
    if (
      !action.startModes.includes(decision.startMode) &&
      !isStartupRepair(request, decision.startMode)
    )
      return yield* launchValidationError(
        `Action '${actionId}' does not permit '${decision.startMode}'.`,
      );
    if (decision.startMode === "reuse") onReuse({ repoPath, ...decision.sourceSession });
    if (decision.startMode === "fresh" && decision.targetWorkingDirectory)
      yield* deps.startPreparation.validateTarget({
        workspaceId: request.workspaceId,
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
      const records = yield* deps.tasks.agentSessionsList({
        workspaceId: request.workspaceId,
        repoPath,
        taskId: request.taskId,
      });
      const stored = findWorkflowSession(records, action.role, source);
      if (!stored)
        return yield* launchValidationError(
          `Task '${request.taskId}' does not own the selected ${action.role} source '${source.externalSessionId}'.`,
        );
      if (decision.startMode === "fork") {
        const sourcePath = yield* deps.git.canonicalizePath(source.workingDirectory);
        if (normalizePathForComparison(sourcePath) === normalizePathForComparison(repoPath))
          return yield* launchValidationError(
            `Legacy repository-root task sessions cannot be forked. Start a fresh ${roleLabel} session in the task worktree.`,
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
      workflow.role(action.role),
    );
    if (!descriptor.capabilities.sessionLifecycle.supportedStartModes.includes(decision.startMode))
      return yield* launchValidationError(
        `Runtime '${runtimeKind}' does not support '${decision.startMode}'. Select a supported launch mode.`,
      );
    yield* deps.registry.requireReady(runtimeKind);
    // The event commits through the workflow event path, so its host effects run first.
    if (request.beforeStartAction) {
      yield* deps.tasks.applyTaskEvent({
        workspaceId: request.workspaceId,
        repoPath,
        taskId: request.taskId,
        eventId: request.beforeStartAction.eventId,
      });
    }
    if (request.targetBranch) {
      yield* deps.tasks.updateTask({
        workspaceId: request.workspaceId,
        repoPath,
        taskId: request.taskId,
        patch: { targetBranch: request.targetBranch },
      });
    }
    task = yield* deps.taskReader.getTask({
      workspaceId: request.workspaceId,
      repoPath,
      taskId: request.taskId,
    });
    yield* validateLaunchAvailable(workflow, task, action, repoPath);
    const systemPrompt = workflow.prompts.systemPrompt({
      role: action.role,
      task: toPromptTask(task),
      overrides,
    }).prompt;
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

export const isStartupRepair = (
  request: WorkflowLaunchAttemptRequest,
  startMode: WorkflowLaunchDecision["startMode"],
): boolean =>
  request.policy.kind === "manual" &&
  request.instruction.kind === "none" &&
  request.startup !== undefined &&
  startMode === "reuse";

/**
 * The launch action of a manual start. A manual start of the core pull request launch names the
 * role of its source session.
 */
export const requireLaunchAction = (
  workflow: TaskWorkflow,
  request: Pick<WorkflowLaunchRequest, "policy">,
): Effect.Effect<TaskWorkflowLaunchAction, HostValidationError> =>
  Effect.try({
    try: () => workflow.launchAction(request.policy.actionId, request.policy.role),
    catch: (cause) => launchValidationError(errorMessage(cause)),
  });

/**
 * The role that the result of a launch names before the launch runs. An automatic launch names
 * the first candidate role of its automation until it selects its source session.
 */
export const requireInitialLaunchRole = (
  workflow: TaskWorkflow,
  request: Pick<WorkflowLaunchAttemptRequest, "policy">,
): Effect.Effect<string, HostValidationError> =>
  request.policy.kind === "manual"
    ? requireLaunchAction(workflow, { policy: request.policy }).pipe(Effect.map(({ role }) => role))
    : Effect.try({
        try: () => workflow.automation(request.policy.actionId).roles[0]!,
        catch: (cause) => launchValidationError(errorMessage(cause)),
      });

/**
 * The core pull request launch runs while the task is not closed and its approval is available.
 * A workflow launch runs while the step of its role is available.
 */
const validateLaunchAvailable = (
  workflow: TaskWorkflow,
  task: TaskFacts,
  action: TaskWorkflowLaunchAction,
  repoPath: string,
) => {
  if (!isPullRequestLaunch(action.id))
    return validateTaskSessionWorkflowAvailable(workflow, task, action.role, repoPath);
  return workflow.pullRequestLaunchAvailable(task)
    ? Effect.void
    : Effect.fail(
        launchValidationError(
          `Pull request generation is not available for task ${task.id} in its current state. Move the task to a state where it can be approved.`,
        ),
      );
};

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

/**
 * Returns why Pull Request generation cannot run, or null. A provider read failure becomes the
 * reason, so Autopilot skips the launch and a manual launch shows the reason.
 */
const pullRequestUnavailableReason = (
  deps: Pick<WorkflowLaunchPreparationDependencies, "provider">,
  workspace: { workspaceId: string; repoPath: string },
) =>
  deps.provider.getContext(workspace).pipe(
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

const toPromptTask = (task: TaskRecord) => ({
  taskId: task.id,
  title: task.title,
  issueType: task.issueType,
  status: task.status,
  description: task.description,
});
