import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import {
  type CanonicalizeRepoPath,
  createTaskWorkflowSessionControlService,
} from "../../application/agent-sessions/task-workflow-session-control-service";
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
}: {
  taskServiceInput: TaskServiceInput;
  eventServiceInput: Omit<Parameters<typeof createNodeTaskEventServices>[0], "baseTaskService">;
  agentSessionLiveStateService: AgentSessionLiveStateService;
  canonicalizeRepoPath: CanonicalizeRepoPath;
}) => {
  const baseTaskService = createTaskServiceWithMutationProgress(taskServiceInput);
  const eventServices = createNodeTaskEventServices({
    ...eventServiceInput,
    baseTaskService,
  });
  const agentSessionCommandService = {
    ...agentSessionLiveStateService,
    ...createTaskWorkflowSessionControlService({
      canonicalizeRepoPath,
      runtime: agentSessionLiveStateService,
      taskReader: taskServiceInput.taskStore,
      tasks: eventServices.taskService,
      taskLifecycle: taskServiceInput.taskSessionLifecycleCoordinator,
      taskSessionStart: createTaskSessionStartPreparationService(taskServiceInput),
    }),
  };
  return { ...eventServices, agentSessionCommandService };
};
