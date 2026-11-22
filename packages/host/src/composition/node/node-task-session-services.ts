import { createSessionGoalRules } from "../../application/agent-sessions/session-goal-rules";
import { createWorkflowReads } from "../../application/tasks/workflow-reads";
import { agentSessionRefKey } from "@openducktor/core";
import { createTaskWorkflowSessionFork } from "../../application/agent-sessions/task-workflow-session-fork";
import { createTaskSessionOperations } from "../../application/agent-sessions/task-session-operations";
import { createRuntimeTaskActivityGuard } from "../../application/tasks/runtime-task-activity-guard";
import {
  createAgentRuntimeQueryService,
  type AgentRuntimeQueryDependencies,
} from "../../application/runtimes/agent-runtime-query-service";
import { createWorkflowLaunchService } from "../../application/agent-sessions/workflow-launch-service";
import { createGitProviderService } from "../../application/git/git-provider-service";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type {
  CanonicalizeRepoPath,
  PrepareRolePolicy,
} from "../../application/agent-sessions/task-session-operations";
import { createAgentSessionCommandService } from "../../application/agent-sessions/agent-session-command-service";
import type { AgentSessionOperationPolicy } from "../../application/agent-sessions/agent-session-operation-policy";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { CreateTaskServiceInput } from "../../application/tasks/task-service";
import type { NamingService } from "../../application/naming/naming-service";
import { createTaskServiceWithMutationProgress } from "../../application/tasks/task-service";
import { createTaskSessionStartPreparationService } from "../../application/tasks/worktrees/task-session-start-preparation-service";
import { createNodeTaskEventServices } from "./node-task-event-services";
import { createTaskWorktreeOwnerReader } from "../../application/workspaces/task-worktree-owner-reader";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";
import type { NodeTaskAssetServices } from "./node-task-asset-services";
import {
  createTaskMergeDetectionService,
  type CreateTaskMergeDetectionServiceInput,
} from "../../application/tasks/merge-detection/task-merge-detection-service";
import { createSessionTurnPreparation } from "../../application/agent-sessions/session-turn-preparation";
import { createHostApprovalPolicy } from "../../application/agent-sessions/host-approval-policy";
import { createHostOperationWorkers } from "../../effect/host-operation-workers";
import { composeRuntimeHandoff, digestHandoffPrefix } from "./node-runtime-handoff";
import { projectSavedHandoffHistory } from "../../application/agent-sessions/runtime-handoff-history";
import type { WorkspaceSessionUpdatedPublisher } from "../../application/workspaces/workspace-session-persistence-callbacks";

type TaskServiceInput = Omit<
  Parameters<typeof createTaskServiceWithMutationProgress>[0],
  "taskActivityGuard"
> &
  Required<
    Pick<
      CreateTaskServiceInput,
      | "taskSessionLifecycleCoordinator"
      | "workspaceSettingsService"
      | "taskWorktreeService"
      | "gitPort"
      | "runtimeDefinitionsService"
      | "runtimeRegistry"
      | "gitProviderResolver"
      | "settingsConfig"
      | "worktreeFiles"
    >
  >;

export const createNodeTaskSessionServices = ({
  taskServiceInput,
  eventServiceInput,
  publishMergeStatus,
  remoteFetch,
  agentSessionLiveStateService,
  canonicalizeRepoPath,
  runtimeAdmission,
  workspaceSessions: {
    persistence: repositoryPolicy,
    readSessionRootRefs: readSavedRoots,
    publishUpdated,
  },
  naming,
  workflowLaunch,
  pauseForStop,
  savedSessions,
  claudeSessionMetadata,
  prepareRolePolicy,
  resolveWorkflowRolePolicy,
  workspaceWorkflows,
}: {
  workspaceWorkflows: import("../../ports/task-workflow-port").WorkspaceWorkflowPort;
  prepareRolePolicy: PrepareRolePolicy;
  resolveWorkflowRolePolicy: import("@openducktor/core").WorkflowRolePolicyResolver;
  taskServiceInput: TaskServiceInput;
  eventServiceInput: Omit<
    Parameters<typeof createNodeTaskEventServices>[0],
    "baseTaskService" | "taskWorkflows" | "mergeDetection" | "settingsConfig"
  >;
  publishMergeStatus: CreateTaskMergeDetectionServiceInput["publish"];
  remoteFetch: CreateTaskMergeDetectionServiceInput["remoteFetch"];
  agentSessionLiveStateService: AgentSessionLiveStateService;
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtimeAdmission: import("../../ports/runtime-admission-port").RuntimeAdmissionPort;
  /** The workspace session composition. */
  workspaceSessions: {
    persistence: AgentSessionOperationPolicy;
    publishUpdated: WorkspaceSessionUpdatedPublisher;
    readSessionRootRefs: Parameters<
      typeof createAgentSessionCommandService
    >[0]["readSessionRootRefs"];
  };
  naming: NamingService;
  workflowLaunch: Pick<
    Parameters<typeof createWorkflowLaunchService>[0],
    "resolveParts" | "messageDelivery"
  > & {
    adapterRegistry: AgentRuntimeQueryDependencies["adapterRegistry"];
    deniedToolParts: AgentRuntimeQueryDependencies["deniedToolParts"];
  };
  pauseForStop: Parameters<typeof createAgentSessionCommandService>[0]["pauseForStop"];
  /** The saved chats and tasks that own sessions and worktrees. */
  savedSessions: Pick<
    NodeTaskAssetServices,
    | "workspaceSessionStore"
    | "taskOwnership"
    | "runtimeHandoffs"
    | "taskStore"
    | "agentSessionTurnStore"
  >;
  claudeSessionMetadata: ClaudeSessionMetadataPort;
}) => {
  const { workspaceSessionStore: store, taskOwnership } = savedSessions;
  const readSessionRootRefs: typeof readSavedRoots = (repoPath) =>
    readSavedRoots(repoPath).pipe(
      Effect.map((saved) => {
        const keys = new Set(saved.map((root) => agentSessionRefKey(root)));
        return [
          ...saved,
          ...agentSessionLiveStateService
            .readStartedRoots(repoPath)
            .filter((root) => !keys.has(agentSessionRefKey(root))),
        ];
      }),
    );
  const baseTaskService = createTaskServiceWithMutationProgress({
    ...taskServiceInput,
    worktreeOwners: createTaskWorktreeOwnerReader({
      store,
      taskOwnership,
      settingsConfig: taskServiceInput.settingsConfig,
      worktreeFiles: taskServiceInput.worktreeFiles,
      claudeSessionMetadata,
    }),
    publishCompletion: (observation) =>
      agentSessionLiveStateService.publishOperation({
        type: "task_completion_updated",
        observation,
      }),
    taskActivityGuard: createRuntimeTaskActivityGuard({
      runtimeRegistry: taskServiceInput.runtimeRegistry,
      hasUnresolvedTaskHandoff: (ref) =>
        agentSessionCommandService.handoff?.hasUnresolvedTaskHandoff(ref) === true,
      sessionService: agentSessionLiveStateService,
      settingsConfig: taskServiceInput.settingsConfig,
      readSessionRootRefs,
    }),
  });
  // The task sync loop runs the scheduled merge detection passes.
  const mergeDetection = createTaskMergeDetectionService({
    taskStore: taskServiceInput.taskStore,
    gitPort: taskServiceInput.gitPort,
    remoteFetch,
    settingsConfig: taskServiceInput.settingsConfig,
    workspaceSettingsService: taskServiceInput.workspaceSettingsService,
    publish: publishMergeStatus,
    logger: eventServiceInput.lifecycleLogger,
  });
  const eventServices = createNodeTaskEventServices({
    ...eventServiceInput,
    settingsConfig: taskServiceInput.settingsConfig,
    baseTaskService,
    mergeDetection,
  });
  const completionWorkers = createHostOperationWorkers();
  const taskService = {
    ...eventServices.taskService,
    directMerge: (input: Parameters<typeof eventServices.taskService.directMerge>[0]) =>
      completionWorkers.run(eventServices.taskService.directMerge(input)),
    completeDirectMerge: (
      input: Parameters<typeof eventServices.taskService.completeDirectMerge>[0],
    ) => completionWorkers.run(eventServices.taskService.completeDirectMerge(input)),
    closeTask: (input: Parameters<typeof eventServices.taskService.closeTask>[0]) =>
      completionWorkers.run(eventServices.taskService.closeTask(input)),
    removeTaskWorktree: (
      input: Parameters<typeof eventServices.taskService.removeTaskWorktree>[0],
    ) => completionWorkers.run(eventServices.taskService.removeTaskWorktree(input)),
    linkMergedPullRequest: (
      input: Parameters<typeof eventServices.taskService.linkMergedPullRequest>[0],
    ) => completionWorkers.run(eventServices.taskService.linkMergedPullRequest(input)),
  };
  const taskSessionStart = createTaskSessionStartPreparationService({
    ...taskServiceInput,
    naming,
  });
  const readHandoffPrefix: Parameters<typeof composeRuntimeHandoff>[0]["readPrefix"] = (
    input,
    candidate,
  ) =>
    Effect.gen(function* () {
      const workspaceId =
        input.sessionScope?.workspaceId ??
        (yield* taskServiceInput.workspaceSettingsService.listWorkspaces()).find(
          (workspace) => workspace.repoPath === input.repoPath,
        )?.workspaceId;
      if (!workspaceId) return null;
      return yield* savedSessions.runtimeHandoffs.prefix({ ...input, workspaceId, candidate });
    }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.read-prefix")));
  const agentRuntimeQueries = createAgentRuntimeQueryService({
    adapterRegistry: workflowLaunch.adapterRegistry,
    deniedToolParts: workflowLaunch.deniedToolParts,
    sessionTurns: savedSessions.agentSessionTurnStore,
    settingsConfig: taskServiceInput.settingsConfig,
    workspaceSettingsService: taskServiceInput.workspaceSettingsService,
    worktreeFiles: taskServiceInput.worktreeFiles,
    gitPort: taskServiceInput.gitPort,
    taskReader: taskServiceInput.taskStore,
    runtimeRegistry: taskServiceInput.runtimeRegistry,
    worktreeReads: taskServiceInput.taskSessionLifecycleCoordinator,
    isAcceptedHandoffMember: (ref, scope): boolean =>
      agentSessionCommandService.handoff?.acceptedDestination(ref, scope) != null,
    isStagedHandoffMember: (ref): boolean =>
      agentSessionCommandService.handoff?.isStagedHandoffMember(ref) === true,
    projectHandoffHistory: (input, history) => {
      const staged = agentSessionCommandService.handoff?.acceptedDestination(input, undefined);
      return projectSavedHandoffHistory(
        history,
        (candidate) =>
          !candidate && staged?.receipt
            ? Effect.succeed({ firstMessageId: staged.firstMessageId, receipt: staged.receipt })
            : readHandoffPrefix(input, candidate),
        digestHandoffPrefix,
      ).pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.read-prefix")));
    },
  });
  const turnPreparation = createSessionTurnPreparation({
    settings: taskServiceInput.workspaceSettingsService,
    settingsConfig: taskServiceInput.settingsConfig,
    queries: agentRuntimeQueries,
    taskReader: taskServiceInput.taskStore,
    taskWorkflows: taskServiceInput.taskWorkflows,
  });
  const approvalPolicy = createHostApprovalPolicy({
    live: agentSessionLiveStateService,
    readRoots: readSessionRootRefs,
    definitions: taskServiceInput.runtimeDefinitionsService,
    preparation: turnPreparation,
    resolveWorkflowRolePolicy,
    reportFailure: (error) =>
      eventServiceInput.onBackgroundFailure(toHostOperationError(error, "approval-policy.observe")),
  });
  const goalRules = createSessionGoalRules({
    definitions: taskServiceInput.runtimeDefinitionsService,
    registry: taskServiceInput.runtimeRegistry,
  });
  const commandDeps: Omit<
    Parameters<typeof createAgentSessionCommandService>[0],
    "tasks" | "runtime"
  > = {
    canonicalizeRepoPath,
    repositoryPolicy,
    pauseForStop,
    readSessionRootRefs,
    turnPreparation,
    approvalPolicy,
    goalRules,
    taskReader: taskServiceInput.taskStore,
    taskWorkflows: taskServiceInput.taskWorkflows,
    persistTaskModel: (input) =>
      eventServices.taskService.agentSessionUpdateModelDeferredPublication(input).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "task-workflow-session.update-model"),
        ),
        Effect.map(({ updated, publish }) => ({
          updated,
          publish: publish.pipe(
            Effect.mapError((cause) =>
              toHostOperationError(cause, "task-workflow-session.publish-model"),
            ),
          ),
        })),
      ),
    taskLifecycle: taskServiceInput.taskSessionLifecycleCoordinator,
    taskSessionStart,
    prepareRolePolicy,
    createHandoff: composeRuntimeHandoff({
      assets: savedSessions,
      taskWorkflows: taskServiceInput.taskWorkflows,
      resolveWorkflowRolePolicy,
      prepareRolePolicy,
      settingsConfig: taskServiceInput.settingsConfig,
      runtimeStatus: taskServiceInput.runtimeRegistry.status,
      runtime: agentSessionLiveStateService,
      queries: agentRuntimeQueries,
      resolveParts: workflowLaunch.resolveParts,
      worktreeReads: taskServiceInput.taskSessionLifecycleCoordinator,
      readPrefix: readHandoffPrefix,
      taskPrompt: turnPreparation.context,
      publishWorkspace: publishUpdated,
      publishTask: (chat, agentSessions) => {
        const active = agentSessions
          .find(
            (record) =>
              record.role === chat.role &&
              record.runtimeKind === chat.first.runtimeKind &&
              record.workingDirectory === chat.first.workingDirectory &&
              record.externalSessionId === chat.first.externalSessionId,
          )
          ?.handoff?.links.at(-1)?.to;
        if (!active) return Effect.void;
        return agentSessionLiveStateService.publishTaskSessionRecords(
          { ...active, repoPath: chat.repoPath },
          { workspaceId: chat.workspaceId, taskId: chat.taskId, agentSessions },
        );
      },
    }),
  };
  const agentSessionCommandService: typeof agentSessionLiveStateService &
    ReturnType<typeof createAgentSessionCommandService> = {
    ...agentSessionLiveStateService,
    ...createAgentSessionCommandService({
      ...commandDeps,
      runtime: agentSessionLiveStateService,
      tasks: eventServices.taskService,
    }),
  };
  const taskSessions = createTaskSessionOperations({
    canonicalizeRepoPath,
    runtime: {
      ...agentSessionLiveStateService,
      ...agentSessionCommandService.prepareSessionCreation,
    },
    tasks: eventServices.taskService,
    taskReader: taskServiceInput.taskStore,
    taskWorkflows: taskServiceInput.taskWorkflows,
    prepareRolePolicy,
    taskLifecycle: taskServiceInput.taskSessionLifecycleCoordinator,
    taskSessionStart,
    writes: {
      saveSession: eventServices.taskService.agentSessionUpsertDeferredPublication,
      applyStartEvent: eventServices.taskService.applyStartEventDeferredPublication,
    },
  });
  const forkWorkflowSession = createTaskWorkflowSessionFork({
    runtimeAdmission,
    commands: agentSessionCommandService,
    sessions: taskSessions,
    stop: agentSessionLiveStateService.stopSession,
  });
  const workflowLaunchService = createWorkflowLaunchService({
    messageDelivery: workflowLaunch.messageDelivery,
    resolveParts: workflowLaunch.resolveParts,
    queries: agentRuntimeQueries,
    settings: taskServiceInput.workspaceSettingsService,
    settingsConfig: taskServiceInput.settingsConfig,
    tasks: eventServices.taskService,
    taskReader: taskServiceInput.taskStore,
    taskWorkflows: taskServiceInput.taskWorkflows,
    worktrees: taskServiceInput.taskWorktreeService,
    git: taskServiceInput.gitPort,
    definitions: taskServiceInput.runtimeDefinitionsService,
    registry: taskServiceInput.runtimeRegistry,
    provider: createGitProviderService({
      resolver: taskServiceInput.gitProviderResolver,
      workspaceSettingsService: taskServiceInput.workspaceSettingsService,
    }),
    // The first instruction uses the same workflow send policy as a composer message.
    runtime: {
      ...agentSessionLiveStateService,
      sendUserMessage: agentSessionCommandService.sendUserMessage,
      updateSessionModel: agentSessionCommandService.updateSessionModel,
    },
    sessions: taskSessions,
    startPreparation: taskSessionStart,
  });
  return {
    ...eventServices,
    mergeDetection,
    taskService,
    shutdownCompletionOperations: completionWorkers.shutdown,
    agentSessionCommandService: { ...agentSessionCommandService, forkWorkflowSession },
    workflowLaunchService,
    workflowReads: createWorkflowReads(workspaceWorkflows),
    agentRuntimeQueries,
    approvalPolicy,
  };
};
