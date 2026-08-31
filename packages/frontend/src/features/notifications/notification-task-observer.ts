import type {
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
  publish,
  onFailure,
}: {
  loadTasks(repoPath: string): Promise<TaskCard[]>;
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
    try {
      const tasks = await loadTasks(event.repoPath);
      if (workspaces.get(event.repoPath) !== workspace) {
        return;
      }
      let entry = entries.get(event.repoPath);
      if (!entry || entry.label !== workspace.repositoryLabel) {
        const projector = createTaskOccurrenceProjector({
          repoPath: event.repoPath,
          repositoryLabel: workspace.repositoryLabel,
        });
        projector.replaceBaseline(tasks);
        entry = {
          label: workspace.repositoryLabel,
          projector,
          tasks: new Map(tasks.map((task) => [task.id, task])),
        };
        entries.set(event.repoPath, entry);
        return;
      }
      entry.projector.replaceBaseline(tasks);
      entry.tasks = new Map(tasks.map((task) => [task.id, task]));
    } catch (cause) {
      reportFailure(event.repoPath, cause);
    }
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
        const previous = workspaces.get(workspace.repoPath);
        if (!previous || previous.repositoryLabel !== workspace.repositoryLabel) {
          workspaces.set(workspace.repoPath, workspace);
          const promise = loadBaseline(workspace);
          baselineLoads.set(workspace.repoPath, { workspace, promise });
          baselines.push(promise);
        } else {
          const pending = baselineLoads.get(workspace.repoPath);
          if (pending?.workspace === previous) {
            baselines.push(pending.promise);
          }
        }
      }
      await Promise.all(baselines);
    },
    resolveTask(repoPath: string, taskId: string): { id: string; title?: string } | null {
      const task = entries.get(repoPath)?.tasks.get(taskId);
      return task ? { id: task.id, title: task.title } : null;
    },
  };
};

export type NotificationTaskObserver = ReturnType<typeof createNotificationTaskObserver>;
export type { NotificationProducerFailure };
