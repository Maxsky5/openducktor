import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type { CanonicalizeRepoPath } from "../../application/agent-sessions/task-workflow-session-policy";
import { createAgentSessionCommandService } from "../../application/agent-sessions/agent-session-command-service";
import type { AgentSessionOperationPolicy } from "../../application/agent-sessions/agent-session-operation-policy";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { CreateTaskServiceInput } from "../../application/tasks/task-service";
import { createTaskServiceWithMutationProgress } from "../../application/tasks/task-service";
import { createTaskSessionStartPreparationService } from "../../application/tasks/worktrees/task-session-start-preparation-service";
import { createNodeTaskEventServices } from "./node-task-event-services";

type TaskServiceInput = Parameters<typeof createTaskServiceWithMutationProgress>[0] &
  Required<Pick<CreateTaskServiceInput, "taskSessionLifecycleCoordinator">>;

export const createNodeTaskSessionServices = ({
  taskServiceInput,
  eventServiceInput,
  agentSessionLiveStateService,
  canonicalizeRepoPath,
  repositoryPolicy,
}: {
  taskServiceInput: TaskServiceInput;
  eventServiceInput: Omit<Parameters<typeof createNodeTaskEventServices>[0], "baseTaskService">;
  agentSessionLiveStateService: AgentSessionLiveStateService;
  canonicalizeRepoPath: CanonicalizeRepoPath;
  repositoryPolicy: AgentSessionOperationPolicy;
}) => {
  const baseTaskService = createTaskServiceWithMutationProgress(taskServiceInput);
  const eventServices = createNodeTaskEventServices({
    ...eventServiceInput,
    baseTaskService,
  });
  const agentSessionCommandService = {
    ...agentSessionLiveStateService,
    ...createAgentSessionCommandService({
      assertProcessStart: taskServiceInput.assertProcessStart,
      canonicalizeRepoPath,
      repositoryPolicy,
      runtime: agentSessionLiveStateService,
      taskReader: taskServiceInput.taskStore,
      tasks: eventServices.taskService,
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
      taskSessionStart: createTaskSessionStartPreparationService(taskServiceInput),
    }),
  };
  return { ...eventServices, agentSessionCommandService };
};
