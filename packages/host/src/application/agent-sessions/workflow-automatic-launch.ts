import type {
  AgentSessionModelSelection,
  AgentSessionRecord,
  RepoConfig,
  WorkflowLaunchDecision,
} from "@openducktor/contracts";
import { findCatalogModel, resolveSavedModelAlias } from "@openducktor/core";
import {
  isPullRequestLaunch,
  type TaskWorkflow,
  type TaskWorkflowLaunchAction,
} from "@openducktor/workflows";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type {
  WorkflowLaunchAttemptRequest,
  WorkflowLaunchPreparationDependencies,
} from "./workflow-launch-types";

export const launchValidationError = (message: string) =>
  new HostValidationError({ field: "workflowLaunch", message });

/**
 * The launch action of an Autopilot automation and the latest task session of its candidate
 * roles. The launch runs as the role of that session. A workflow launch action has one role, so
 * it runs as that role when no session exists. The core pull request launch only continues or
 * forks a session, so Autopilot skips it when no session of a pull request role exists.
 */
export const resolveAutomaticLaunch = (
  deps: WorkflowLaunchPreparationDependencies,
  workflow: TaskWorkflow,
  request: WorkflowLaunchAttemptRequest,
  actionId: string,
  repoPath: string,
) =>
  Effect.gen(function* () {
    const automation = yield* Effect.try({
      try: () => workflow.automation(actionId),
      catch: (cause) => launchValidationError(errorMessage(cause)),
    });
    const records = yield* deps.tasks.agentSessionsList({
      workspaceId: request.workspaceId,
      repoPath,
      taskId: request.taskId,
    });
    const latest = records
      .filter((record) => automation.roles.includes(record.role))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    if (!latest && isPullRequestLaunch(automation.launchActionId))
      return {
        kind: "skipped" as const,
        reason: `No ${automation.roles.map((role) => workflow.role(role).label).join(" or ")} session is available to create the pull request for task ${request.taskId}.`,
      };
    const action = yield* Effect.try({
      try: () =>
        workflow.launchAction(automation.launchActionId, latest?.role ?? automation.roles[0]),
      catch: (cause) => launchValidationError(errorMessage(cause)),
    });
    return { kind: "resolved" as const, action, latest };
  });

/** Autopilot applies the same start rules as the manual start modal. */
export const decideAutomaticLaunch = (
  deps: WorkflowLaunchPreparationDependencies,
  {
    request,
    workflow,
    actionId,
    repoPath,
    config,
    action,
    latest,
    alwaysStartQaReviewsFresh,
  }: {
    request: WorkflowLaunchAttemptRequest;
    workflow: TaskWorkflow;
    actionId: string;
    repoPath: string;
    config: RepoConfig;
    action: TaskWorkflowLaunchAction;
    /** The latest task session of the automation roles. */
    latest: AgentSessionRecord | undefined;
    alwaysStartQaReviewsFresh: boolean;
  },
) =>
  Effect.gen(function* () {
    const { startMode } = workflow.automation(actionId);
    const { role, startModes: allowedStartModes } = action;
    const sourceSession = latest && {
      externalSessionId: latest.externalSessionId,
      runtimeKind: latest.runtimeKind,
      workingDirectory: latest.workingDirectory,
    };
    const configuredModel = () =>
      resolveConfiguredDefaultModel(deps, repoPath, config, role, request.workspaceId);
    const canStartFresh = allowedStartModes.includes("fresh");
    // A role that writes a review starts each Autopilot review fresh when the setting asks for it.
    const forceFresh =
      canStartFresh &&
      alwaysStartQaReviewsFresh &&
      workflow.role(role).writes.some((code) => workflow.artifact(code)?.kind === "review");
    if (startMode === "fork" && !forceFresh) {
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
    const reuse = startMode === "reuse" && !forceFresh;
    const continuation =
      reuse || action.requiresWorktree
        ? yield* deps.worktrees.getTaskWorktree({
            workspaceId: request.workspaceId,
            repoPath,
            taskId: request.taskId,
          })
        : null;
    const roleLabel = workflow.role(role).label;
    if (action.requiresWorktree && !continuation)
      return {
        kind: "skipped" as const,
        reason: `${roleLabel} continuation cannot start until a task worktree exists for task ${request.taskId}.`,
      };
    if (reuse) {
      if (
        continuation &&
        sourceSession &&
        normalizePathForComparison(sourceSession.workingDirectory) ===
          normalizePathForComparison(continuation.workingDirectory)
      ) {
        const decision: WorkflowLaunchDecision = { startMode: "reuse", sourceSession };
        return { kind: "decided" as const, decision };
      }
      // An action that also starts fresh starts fresh when no session can continue the task.
      if (!canStartFresh)
        return {
          kind: "skipped" as const,
          reason: `No ${roleLabel} session in the task worktree is available to reuse for task ${request.taskId}.`,
        };
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
  role: string,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const savedDefault = config.agentDefaults[role] ?? config.defaultModel;
    if (!savedDefault)
      return yield* launchValidationError(
        `Configure the ${role} role default or repository default model in workspace '${workspaceId}'.`,
      );
    const runtimeKind = savedDefault.runtimeKind;
    const { models } = yield* deps.queries.loadRuntimeCatalog({
      repoPath,
      runtimeKind,
      workingDirectory: repoPath,
    });
    if (models?.status !== "available")
      return yield* launchValidationError(
        `The ${role} default model for runtime ${runtimeKind} could not load: ${models?.status === "failed" ? models.message : "the runtime returned no model catalog."} Update the default in repository settings.`,
      );
    const configured = resolveSavedModelAlias(models.catalog, savedDefault);
    const entry = findCatalogModel(models.catalog, configured);
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

export const withSpeed = (
  model: AgentSessionModelSelection,
  speed: string | null,
): AgentSessionModelSelection => {
  const { speed: _speed, ...selection } = model;
  return speed === null ? selection : { ...selection, speed };
};
