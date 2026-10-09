import { createTaskSessionOperations } from "../../application/agent-sessions/task-session-operations";
import { createRuntimeTaskActivityGuard } from "../../application/tasks/runtime-task-activity-guard";
import {
  createAgentRuntimeQueryService,
  type AgentRuntimeQueryDependencies,
} from "../../application/runtimes/agent-runtime-query-service";
import type { HostEventBusPort } from "../../events/host-event-bus";
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
}: {
  taskServiceInput: TaskServiceInput;
  eventServiceInput: Omit<Parameters<typeof createNodeTaskEventServices>[0], "baseTaskService">;
  agentSessionLiveStateService: AgentSessionLiveStateService;
  canonicalizeRepoPath: CanonicalizeRepoPath;
  repositoryPolicy: AgentSessionOperationPolicy;
  workflowLaunch: Pick<
    Parameters<typeof createWorkflowLaunchService>[0],
    "withProcessStartAdmission" | "resolveParts"
  > & {
    eventBus: HostEventBusPort | undefined;
    adapterRegistry: AgentRuntimeQueryDependencies["adapterRegistry"];
  };
}) => {
  const baseTaskService = createTaskServiceWithMutationProgress({
    ...taskServiceInput,
    taskActivityGuard: createRuntimeTaskActivityGuard({
      runtimeRegistry: taskServiceInput.runtimeRegistry,
      sessionService: agentSessionLiveStateService,
      settingsConfig: taskServiceInput.settingsConfig,
    }),
  });
  const eventServices = createNodeTaskEventServices({
    ...eventServiceInput,
    baseTaskService,
  });
  const taskSessionStart = createTaskSessionStartPreparationService(taskServiceInput);
  const commandDeps: Omit<
    Parameters<typeof createAgentSessionCommandService>[0],
    "tasks" | "runtime"
  > = {
    canonicalizeRepoPath,
    repositoryPolicy,
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
  const workflowLaunchService = createWorkflowLaunchService({
    resolveParts: workflowLaunch.resolveParts,
    queries: agentRuntimeQueries,
    withProcessStartAdmission: workflowLaunch.withProcessStartAdmission,
    publish: (snapshot) =>
      Effect.try({
        try: () =>
          workflowLaunch.eventBus?.publish({
            channel: "openducktor://run-event",
            payload: { type: "workflow_launch_updated", snapshot: JSON.stringify(snapshot) },
          }),
        catch: (cause) => toHostOperationError(cause, "workflow-launch.publish"),
      }),
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
    runtime: agentSessionLiveStateService,
    lifecycle: taskServiceInput.taskSessionLifecycleCoordinator,
    sessions: createTaskSessionOperations({
      canonicalizeRepoPath,
      runtime: agentSessionLiveStateService,
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
    agentSessionCommandService,
    workflowLaunchService,
    agentRuntimeQueries,
  };
};
