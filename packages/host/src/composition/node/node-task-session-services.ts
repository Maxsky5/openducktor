import { agentSessionRefKey } from "@openducktor/core";
import { createTaskSessionOperations } from "../../application/agent-sessions/task-session-operations";
import { createRuntimeTaskActivityGuard } from "../../application/tasks/runtime-task-activity-guard";
import {
  createAgentRuntimeQueryService,
  type AgentRuntimeQueryDependencies,
} from "../../application/runtimes/agent-runtime-query-service";
import { createWorkflowLaunchService } from "../../application/agent-sessions/workflow-launch-service";
import { createGitProviderService } from "../../application/git/git-provider-service";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type { CanonicalizeRepoPath } from "../../application/agent-sessions/task-session-operations";
import { createAgentSessionCommandService } from "../../application/agent-sessions/agent-session-command-service";
import type { AgentSessionOperationPolicy } from "../../application/agent-sessions/agent-session-operation-policy";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { CreateTaskServiceInput } from "../../application/tasks/task-service";
import { createTaskServiceWithMutationProgress } from "../../application/tasks/task-service";
import { createTaskSessionStartPreparationService } from "../../application/tasks/worktrees/task-session-start-preparation-service";
import { createNodeTaskEventServices } from "./node-task-event-services";
import { createSessionTurnPreparation } from "../../application/agent-sessions/session-turn-preparation";
import { createHostApprovalPolicy } from "../../application/agent-sessions/host-approval-policy";
import { createHostOperationWorkers } from "../../effect/host-operation-workers";

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
  agentSessionLiveStateService,
  canonicalizeRepoPath,
  repositoryPolicy,
  workflowLaunch,
  pauseForStop,
  readSessionRootRefs: readSavedRoots,
}: {
  taskServiceInput: TaskServiceInput;
  eventServiceInput: Omit<Parameters<typeof createNodeTaskEventServices>[0], "baseTaskService">;
  agentSessionLiveStateService: AgentSessionLiveStateService;
  canonicalizeRepoPath: CanonicalizeRepoPath;
  repositoryPolicy: AgentSessionOperationPolicy;
  workflowLaunch: Pick<Parameters<typeof createWorkflowLaunchService>[0], "resolveParts"> & {
    adapterRegistry: AgentRuntimeQueryDependencies["adapterRegistry"];
  };
  pauseForStop: Parameters<typeof createAgentSessionCommandService>[0]["pauseForStop"];
  readSessionRootRefs: Parameters<
    typeof createAgentSessionCommandService
  >[0]["readSessionRootRefs"];
}) => {
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
    publishCompletion: (observation) =>
      agentSessionLiveStateService.publishOperation({
        type: "task_completion_updated",
        observation,
      }),
    taskActivityGuard: createRuntimeTaskActivityGuard({
      runtimeRegistry: taskServiceInput.runtimeRegistry,
      sessionService: agentSessionLiveStateService,
      settingsConfig: taskServiceInput.settingsConfig,
      readSessionRootRefs,
    }),
  });
  const eventServices = createNodeTaskEventServices({
    ...eventServiceInput,
    baseTaskService,
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
    humanApprove: (input: Parameters<typeof eventServices.taskService.humanApprove>[0]) =>
      completionWorkers.run(eventServices.taskService.humanApprove(input)),
    linkMergedPullRequest: (
      input: Parameters<typeof eventServices.taskService.linkMergedPullRequest>[0],
    ) => completionWorkers.run(eventServices.taskService.linkMergedPullRequest(input)),
  };
  const taskSessionStart = createTaskSessionStartPreparationService(taskServiceInput);
  const agentRuntimeQueries = createAgentRuntimeQueryService({
    adapterRegistry: workflowLaunch.adapterRegistry,
    settingsConfig: taskServiceInput.settingsConfig,
    workspaceSettingsService: taskServiceInput.workspaceSettingsService,
    worktreeFiles: taskServiceInput.worktreeFiles,
    gitPort: taskServiceInput.gitPort,
    taskReader: taskServiceInput.taskStore,
    runtimeRegistry: taskServiceInput.runtimeRegistry,
    worktreeReads: taskServiceInput.taskSessionLifecycleCoordinator,
  });
  const turnPreparation = createSessionTurnPreparation({
    settings: taskServiceInput.workspaceSettingsService,
    queries: agentRuntimeQueries,
    taskReader: taskServiceInput.taskStore,
  });
  const approvalPolicy = createHostApprovalPolicy({
    live: agentSessionLiveStateService,
    readRoots: readSessionRootRefs,
    definitions: taskServiceInput.runtimeDefinitionsService,
    preparation: turnPreparation,
    reportFailure: (error) =>
      eventServiceInput.onBackgroundFailure(toHostOperationError(error, "approval-policy.observe")),
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
    taskReader: taskServiceInput.taskStore,
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
  };
  const agentSessionCommandService = {
    ...agentSessionLiveStateService,
    ...createAgentSessionCommandService({
      ...commandDeps,
      runtime: agentSessionLiveStateService,
      tasks: eventServices.taskService,
    }),
  };
  const workflowLaunchService = createWorkflowLaunchService({
    resolveParts: workflowLaunch.resolveParts,
    queries: agentRuntimeQueries,
    settings: taskServiceInput.workspaceSettingsService,
    tasks: eventServices.taskService,
    taskReader: taskServiceInput.taskStore,
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
    sessions: createTaskSessionOperations({
      canonicalizeRepoPath,
      runtime: {
        ...agentSessionLiveStateService,
        ...agentSessionCommandService.prepareSessionCreation,
      },
      tasks: eventServices.taskService,
      taskReader: taskServiceInput.taskStore,
      taskLifecycle: taskServiceInput.taskSessionLifecycleCoordinator,
      taskSessionStart,
      writes: {
        saveSession: eventServices.taskService.agentSessionUpsertDeferredPublication,
        transitionTask: eventServices.taskService.transitionTaskDeferredPublication,
      },
    }),
    startPreparation: taskSessionStart,
  });
  return {
    ...eventServices,
    taskService,
    shutdownCompletionOperations: completionWorkers.shutdown,
    agentSessionCommandService,
    workflowLaunchService,
    agentRuntimeQueries,
    approvalPolicy,
  };
};
