import type { TaskPersistencePort, TaskUpdateInput } from "./bd-persistence";
import type { RawIssue, TaskCard, TaskStatus } from "./contracts";
import type { TaskIndexCache } from "./task-index-cache";
import { issueToTaskCard } from "./task-mapping";
import {
  assertTransitionAllowed as assertTaskTransitionAllowed,
  type RefreshedTaskState,
  refreshTaskContext,
  resolveTaskContext,
  type TaskContext,
  transitionTask,
} from "./task-transitions";

export type OdtTaskWorkflowRuntimePort = {
  metadataNamespace: string;
  ensureInitialized(): Promise<void>;
  applyTaskUpdate(taskId: string, input: TaskUpdateInput): Promise<RefreshedTaskState>;
  readTaskSnapshot(taskId: string): Promise<{ issue: RawIssue; task: TaskCard }>;
  resolveTaskContext(taskId: string): Promise<TaskContext>;
  refreshTaskContext(taskId: string, context?: TaskContext): Promise<TaskContext>;
  assertTransitionAllowed(task: TaskCard, tasks: TaskCard[], nextStatus: TaskStatus): void;
  transitionTask(
    taskId: string,
    nextStatus: TaskStatus,
    context?: TaskContext,
  ): Promise<RefreshedTaskState>;
};

type TaskLookupPort = Pick<TaskIndexCache, "invalidate" | "resolveTask">;

export type OdtTaskWorkflowRuntimeDeps = {
  persistence: TaskPersistencePort;
  taskLookup: TaskLookupPort;
};

class DefaultOdtTaskWorkflowRuntime implements OdtTaskWorkflowRuntimePort {
  readonly metadataNamespace: string;
  private readonly persistence: TaskPersistencePort;
  private readonly taskLookup: TaskLookupPort;

  constructor(deps: OdtTaskWorkflowRuntimeDeps) {
    this.persistence = deps.persistence;
    this.taskLookup = deps.taskLookup;
    this.metadataNamespace = deps.persistence.metadataNamespace;
  }

  async ensureInitialized(): Promise<void> {
    await this.persistence.ensureInitialized();
  }

  async applyTaskUpdate(taskId: string, input: TaskUpdateInput): Promise<RefreshedTaskState> {
    await this.persistence.updateTask(taskId, input);

    const issue = await this.persistence.showRawIssue(taskId);
    this.taskLookup.invalidate();
    return {
      issue,
      task: issueToTaskCard(issue, this.metadataNamespace),
    };
  }

  async readTaskSnapshot(taskId: string): Promise<{ issue: RawIssue; task: TaskCard }> {
    const resolvedTask = await this.taskLookup.resolveTask(taskId);
    const issue = await this.persistence.showRawIssue(resolvedTask.id);
    const task = issueToTaskCard(issue, this.metadataNamespace);
    return { issue, task };
  }

  async resolveTaskContext(taskId: string): Promise<TaskContext> {
    return resolveTaskContext(taskId, () => this.persistence.listTasks());
  }

  async refreshTaskContext(taskId: string, context?: TaskContext): Promise<TaskContext> {
    return refreshTaskContext({
      taskId,
      ...(context ? { context } : {}),
      showRawIssue: (id) => this.persistence.showRawIssue(id),
      metadataNamespace: this.metadataNamespace,
    });
  }

  assertTransitionAllowed(task: TaskCard, tasks: TaskCard[], nextStatus: TaskStatus): void {
    assertTaskTransitionAllowed(task, tasks, nextStatus);
  }

  async transitionTask(
    taskId: string,
    nextStatus: TaskStatus,
    context?: TaskContext,
  ): Promise<RefreshedTaskState> {
    return transitionTask({
      taskId,
      nextStatus,
      ...(context ? { context } : {}),
      listTasks: () => this.persistence.listTasks(),
      runBdJson: (args) => this.persistence.runBdJson(args),
      showRawIssue: (id) => this.persistence.showRawIssue(id),
      invalidateTaskIndex: () => this.taskLookup.invalidate(),
      metadataNamespace: this.metadataNamespace,
    });
  }
}

export const createOdtTaskWorkflowRuntime = (
  deps: OdtTaskWorkflowRuntimeDeps,
): OdtTaskWorkflowRuntimePort => new DefaultOdtTaskWorkflowRuntime(deps);
