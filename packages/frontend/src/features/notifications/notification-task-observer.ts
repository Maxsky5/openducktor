import type {
  AgentSessionRecord,
  AgentSessionLiveRef,
  AgentSessionWorkflowScope,
  ExternalTaskSyncEvent,
  NotificationOccurrence,
  TaskCard,
  TaskEventTaskSnapshot,
} from "@openducktor/contracts";
import { isCancelledError } from "@tanstack/react-query";
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

type BaselineOutcome = {
  repoPath: string;
  status: "failed" | "ready";
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
  const interruptedBaselines = new Set<string>();
  const baselineOutcomeListeners = new Set<(outcome: BaselineOutcome) => void>();
  const baselineAttempts = new Map<string, object>();
  const baselineLoads = new Map<
    string,
    { workspace: NotificationWorkspace; promise: Promise<void> }
  >();

  const reportFailure = (repoPath: string, cause: unknown): void => {
    onFailure({ repoPath, source: "task", cause });
  };

  const notifyBaselineOutcome = (outcome: BaselineOutcome): void => {
    for (const listener of baselineOutcomeListeners) listener(outcome);
  };

  const loadBaseline = async (workspace: NotificationWorkspace): Promise<void> => {
    const attempt = {};
    baselineAttempts.set(workspace.repoPath, attempt);
    const isCurrentAttempt = (): boolean =>
      workspaces.get(workspace.repoPath) === workspace &&
      baselineAttempts.get(workspace.repoPath) === attempt;
    try {
      const tasks = await loadTasks(workspace.repoPath);
      await loadSessionRecords(
        workspace.repoPath,
        tasks.map((task) => task.id),
      );
      if (!isCurrentAttempt()) {
        return;
      }
      const previous = entries.get(workspace.repoPath);
      const projector =
        previous?.label === workspace.repositoryLabel
          ? previous.projector
          : createTaskOccurrenceProjector({
              repoPath: workspace.repoPath,
              repositoryLabel: workspace.repositoryLabel,
            });
      entries.set(workspace.repoPath, {
        label: workspace.repositoryLabel,
        projector,
        tasks: new Map(tasks.map((task) => [task.id, task])),
      });
      interruptedBaselines.delete(workspace.repoPath);
      notifyBaselineOutcome({ repoPath: workspace.repoPath, status: "ready" });
    } catch (cause) {
      if (isCancelledError(cause)) {
        if (
          workspaces.get(workspace.repoPath) === workspace &&
          entries.get(workspace.repoPath)?.label !== workspace.repositoryLabel
        ) {
          interruptedBaselines.add(workspace.repoPath);
        }
        return;
      }
      if (!isCurrentAttempt()) {
        return;
      }
      const recoveryFailed = interruptedBaselines.delete(workspace.repoPath);
      reportFailure(workspace.repoPath, cause);
      if (recoveryFailed) {
        notifyBaselineOutcome({ repoPath: workspace.repoPath, status: "failed" });
      }
    } finally {
      if (baselineAttempts.get(workspace.repoPath) === attempt) {
        baselineAttempts.delete(workspace.repoPath);
      }
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
      const pending = baselineLoads.get(event.repoPath);
      if (pending?.workspace === workspace) {
        await pending.promise;
      } else {
        await loadBaseline(workspace);
      }
      if (workspaces.get(event.repoPath) !== workspace) return;
      entry = entries.get(event.repoPath);
      if (!entry || entry.label !== workspace.repositoryLabel) {
        throw new Error("Task notification baseline is unavailable. Reload to reconnect.");
      }
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
    isBaselineInterrupted: (repoPath: string): boolean => interruptedBaselines.has(repoPath),
    subscribeBaselineOutcome(listener: (outcome: BaselineOutcome) => void): () => void {
      baselineOutcomeListeners.add(listener);
      return () => baselineOutcomeListeners.delete(listener);
    },
    async syncWorkspaces(nextWorkspaces: readonly NotificationWorkspace[]): Promise<void> {
      const nextRepoPaths = new Set(nextWorkspaces.map((workspace) => workspace.repoPath));
      for (const repoPath of workspaces.keys()) {
        if (!nextRepoPaths.has(repoPath)) {
          workspaces.delete(repoPath);
          entries.delete(repoPath);
          baselineAttempts.delete(repoPath);
          baselineLoads.delete(repoPath);
          interruptedBaselines.delete(repoPath);
        }
      }
      const baselines: Promise<void>[] = [];
      for (const workspace of nextWorkspaces) {
        let owner = workspaces.get(workspace.repoPath);
        if (!owner || owner.repositoryLabel !== workspace.repositoryLabel) {
          owner = { ...workspace };
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
