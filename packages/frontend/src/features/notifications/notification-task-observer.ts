import type {
  AgentSessionRecord,
  AgentSessionLiveRef,
  AgentSessionWorkflowScope,
  ExternalTaskSyncEvent,
  NotificationOccurrence,
  TaskCard,
  TaskEventTaskSnapshot,
} from "@openducktor/contracts";
import type { TaskStreamNotificationSink } from "@/state/tasks/task-stream-controller";
import { createTaskOccurrenceProjector } from "./task-occurrence-projector";

export type NotificationWorkspace = {
  repoPath: string;
  repositoryLabel: string;
};

type NotificationProducerFailure = {
  repoPath: string;
  source: "session" | "task";
  cause: unknown;
};

type TaskObserverEntry = {
  label: string;
  projector: ReturnType<typeof createTaskOccurrenceProjector>;
  tasks: Map<string, TaskEventTaskSnapshot>;
};

export const createNotificationTaskObserver = ({
  loadTasks,
  loadSessionRecords,
  resolveSessionAssociation,
  publish,
  onFailure,
}: {
  loadTasks(repoPath: string): Promise<TaskCard[]>;
  loadSessionRecords(
    repoPath: string,
    taskIds: string[],
  ): Promise<Record<string, AgentSessionRecord[]>>;
  resolveSessionAssociation(ref: AgentSessionLiveRef): AgentSessionWorkflowScope | null;
  publish(occurrence: NotificationOccurrence): void;
  onFailure(failure: NotificationProducerFailure): void;
}) => {
  const workspaces = new Map<string, NotificationWorkspace>();
  const entries = new Map<string, TaskObserverEntry>();
  const baselineLoads = new Map<
    string,
    { workspace: NotificationWorkspace; promise: Promise<void> }
  >();

  const reportFailure = (repoPath: string, cause: unknown): void => {
    onFailure({ repoPath, source: "task", cause });
  };

  const loadBaseline = async (workspace: NotificationWorkspace): Promise<void> => {
    try {
      const tasks = await loadTasks(workspace.repoPath);
      await loadSessionRecords(
        workspace.repoPath,
        tasks.map((task) => task.id),
      );
      if (workspaces.get(workspace.repoPath) !== workspace) {
        return;
      }
      const projector = createTaskOccurrenceProjector({
        repoPath: workspace.repoPath,
        repositoryLabel: workspace.repositoryLabel,
      });
      projector.replaceBaseline(tasks);
      entries.set(workspace.repoPath, {
        label: workspace.repositoryLabel,
        projector,
        tasks: new Map(tasks.map((task) => [task.id, task])),
      });
    } catch (cause) {
      reportFailure(workspace.repoPath, cause);
    }
  };

  const refreshForExternalTask = async (
    event: Extract<ExternalTaskSyncEvent, { kind: "external_task_created" }>,
  ): Promise<void> => {
    const workspace = workspaces.get(event.repoPath);
    if (!workspace) {
      return;
    }
    const entry = entries.get(event.repoPath);
    if (!entry || entry.label !== workspace.repositoryLabel) {
      await loadBaseline(workspace);
      return;
    }
    if (!entry.tasks.has(event.taskId)) {
      entry.projector.addCreatedTask(event.taskSnapshot);
      entry.tasks.set(event.taskId, event.taskSnapshot);
    }
    await loadSessionRecords(event.repoPath, [event.taskId]);
  };

  const refreshForChange = async (event: ExternalTaskSyncEvent): Promise<void> => {
    if (event.kind === "external_task_created") {
      await refreshForExternalTask(event);
      return;
    }
    const workspace = workspaces.get(event.repoPath);
    if (!workspace) return;
    let entry = entries.get(event.repoPath);
    if (!entry || entry.label !== workspace.repositoryLabel) {
      await loadBaseline(workspace);
      return;
    }
    const occurrences = entry.projector.projectChange(event);
    for (const taskId of event.removedTaskIds) entry.tasks.delete(taskId);
    for (const task of event.taskSnapshots) entry.tasks.set(task.id, task);
    for (const occurrence of occurrences) publish(occurrence);
    await loadSessionRecords(event.repoPath, [...entry.tasks.keys()]);
  };

  const refreshAllBaselines = async (): Promise<void> => {
    await Promise.all([...workspaces.values()].map(loadBaseline));
  };

  const sink: TaskStreamNotificationSink = {
    onChange: refreshForChange,
    onSnapshot: refreshAllBaselines,
    onFailure: (cause) => onFailure({ repoPath: "task-stream", source: "task", cause }),
  };

  return {
    sink,
    hasBaseline: (repoPath: string): boolean =>
      entries.get(repoPath)?.label === workspaces.get(repoPath)?.repositoryLabel &&
      entries.has(repoPath),
    async syncWorkspaces(nextWorkspaces: readonly NotificationWorkspace[]): Promise<void> {
      const nextRepoPaths = new Set(nextWorkspaces.map((workspace) => workspace.repoPath));
      for (const repoPath of workspaces.keys()) {
        if (!nextRepoPaths.has(repoPath)) {
          workspaces.delete(repoPath);
          entries.delete(repoPath);
          baselineLoads.delete(repoPath);
        }
      }
      const baselines: Promise<void>[] = [];
      for (const workspace of nextWorkspaces) {
        let owner = workspaces.get(workspace.repoPath);
        if (!owner || owner.repositoryLabel !== workspace.repositoryLabel) {
          owner = workspace;
          workspaces.set(workspace.repoPath, owner);
        }
        const pending = baselineLoads.get(workspace.repoPath);
        if (pending?.workspace === owner) {
          baselines.push(pending.promise);
          continue;
        }
        if (entries.get(workspace.repoPath)?.label === owner.repositoryLabel) continue;
        const registration = { workspace: owner, promise: Promise.resolve() };
        registration.promise = loadBaseline(owner).finally(() => {
          if (baselineLoads.get(workspace.repoPath) === registration) {
            baselineLoads.delete(workspace.repoPath);
          }
        });
        baselineLoads.set(workspace.repoPath, registration);
        baselines.push(registration.promise);
      }
      await Promise.all(baselines);
    },
    resolveTask(repoPath: string, taskId: string): { id: string; title?: string } | null {
      const task = entries.get(repoPath)?.tasks.get(taskId);
      return task ? { id: task.id, title: task.title } : null;
    },
    resolveSessionAssociation(ref: AgentSessionLiveRef): AgentSessionWorkflowScope | null {
      return entries.has(ref.repoPath) ? resolveSessionAssociation(ref) : null;
    },
  };
};

export type NotificationTaskObserver = ReturnType<typeof createNotificationTaskObserver>;
export type { NotificationProducerFailure };
