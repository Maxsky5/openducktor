import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type {
  AgentSessionScope,
  NotificationOccurrence,
  TaskEventTaskSnapshot,
  WorkspaceRecord,
  WorkspaceSession,
  ExternalTaskSyncEvent,
  AgentSessionLiveEnvelope,
  TaskAutoCloseFailure,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { createSessionOccurrenceProjector } from "./session-occurrence-projector";
import { createTaskOccurrenceProjector } from "./task-occurrence-projector";
import { Effect, Fiber, Queue } from "effect";
import type { HostOperationError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
export type WorkspaceNotificationInput =
  | { type: "task"; event: ExternalTaskSyncEvent }
  | { type: "live"; envelope: AgentSessionLiveEnvelope; provenance: "baseline" | "live" }
  | { type: "association"; session: WorkspaceSession }
  | { type: "auto_close_blocked"; failure: TaskAutoCloseFailure };

/** The health source that a failed input reports. */
export const notificationInputSource = (input: WorkspaceNotificationInput): "task" | "session" =>
  input.type === "task" || input.type === "auto_close_blocked" ? "task" : "session";
type WorkspaceState = {
  record: WorkspaceRecord;
  active: boolean;
  queue: Queue.Queue<WorkspaceNotificationInput>;
  fiber: Fiber.Fiber<void, never> | null;
  liveKeys: Set<string>;
  initialized: boolean;
  tasks: Map<string, TaskEventTaskSnapshot>;
  taskOwners: Map<string, { taskId: string; scope: AgentSessionScope }>;
  workspaceOwners: Map<string, WorkspaceSession>;
  taskProjector: ReturnType<typeof createTaskOccurrenceProjector>;
  projector: ReturnType<typeof createSessionOccurrenceProjector>;
};

/**
 * Watch live changes while loading the baseline. Drain them before attaching owners
 * so requests resolved during startup do not create alerts.
 */
export const createWorkspaceNotificationObserver = ({
  record,
  taskWorkflows,
  tasks,
  live,
  workspaceSessions,
  select,
  failure,
  recovered,
}: {
  record: WorkspaceRecord;
  taskWorkflows: TaskWorkflowResolver;
  tasks: Pick<TaskService, "listTasks" | "agentSessionsListForTasks">;
  live: Pick<AgentSessionLiveStateService, "attach">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "listActive">;
  select(occurrence: NotificationOccurrence): Effect.Effect<void, HostOperationError>;
  failure(scope: string, source: "initialization" | "task" | "session", cause: unknown): void;
  recovered(scope: string): void;
}) =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<WorkspaceNotificationInput>(1024);
    const state: WorkspaceState = {
      record,
      queue,
      active: true,
      fiber: null,
      liveKeys: new Set(),
      initialized: false,
      tasks: new Map(),
      taskOwners: new Map(),
      workspaceOwners: new Map(),
      taskProjector: createTaskOccurrenceProjector({
        repoPath: record.repoPath,
        repositoryLabel: record.workspaceName,
        taskWorkflows,
      }),
      projector: createSessionOccurrenceProjector({
        repositoryLabel: record.workspaceName,
        resolveTask: (id) => {
          const task = state.tasks.get(id);
          return task ? { id: task.id, title: task.title } : null;
        },
        resolveAssociation: (ref) => {
          if (!state.initialized) return null;
          const key = agentSessionRefKey(ref);
          const task = state.taskOwners.get(key);
          if (task) return task.scope;
          return state.workspaceOwners.has(key)
            ? { kind: "repository", workspaceId: record.workspaceId }
            : null;
        },
      }),
    };
    const addWorkspaceSessionTitle = (
      occurrence: NotificationOccurrence,
    ): NotificationOccurrence => {
      if (occurrence.task) {
        if (occurrence.copy || !occurrence.role) return occurrence;
        const task = state.tasks.get(occurrence.task.id);
        if (!task)
          throw new Error(
            `Notification task "${occurrence.task.id}" is unavailable. Reload the workspace.`,
          );
        const role = taskWorkflows.forReference(task.workflow).role(occurrence.role);
        return {
          ...occurrence,
          workflow: task.workflow,
          copy: { title: role.label, body: occurrence.status },
        };
      }

      const target = occurrence.navigationTarget;
      switch (target.type) {
        case "agent_session":
        case "pending_input":
        case "session_error":
          break;
        case "notification_settings":
        case "agent_studio_task":
        case "kanban_task":
          return occurrence;
      }

      const sessionKey = agentSessionRefKey({
        repoPath: state.record.repoPath,
        ...target.session,
      });
      const workspaceSession = state.workspaceOwners.get(sessionKey);
      if (!workspaceSession) return occurrence;

      return {
        ...occurrence,
        sessionLabel: runtimeTitle(workspaceSession) ?? "Untitled session",
      };
    };
    const publishOccurrence = (
      occurrence: NotificationOccurrence,
    ): Effect.Effect<void, HostOperationError> =>
      Effect.suspend(() => {
        if (!state.active) return Effect.void;
        return select(
          addWorkspaceSessionTitle({
            ...occurrence,
            workspaceId: state.record.workspaceId,
            navigationTarget:
              occurrence.navigationTarget.type === "notification_settings"
                ? occurrence.navigationTarget
                : { ...occurrence.navigationTarget, workspaceId: state.record.workspaceId },
          }),
        );
      });
    const publish = (occurrences: NotificationOccurrence[]) =>
      Effect.forEach(occurrences, publishOccurrence, { discard: true });
    const refreshOwners = () => publish(state.projector.reconcileAssociations());
    const setWorkspaceSession = (session: WorkspaceSession) => {
      for (const [key, existing] of state.workspaceOwners) {
        if (existing.id === session.id) {
          state.workspaceOwners.delete(key);
          if (
            session.archivedAt !== null ||
            session.externalSessionId !== existing.externalSessionId
          )
            state.projector.invalidateOwnership(key);
        }
      }
      if (session.archivedAt === null && session.externalSessionId) {
        state.workspaceOwners.set(
          agentSessionRefKey({
            repoPath: state.record.repoPath,
            runtimeKind: session.runtimeKind,
            workingDirectory: session.executionTarget.workingDirectory,
            externalSessionId: session.externalSessionId,
          }),
          session,
        );
      }
    };
    const refreshTaskOwners = (taskIds: string[]) =>
      Effect.gen(function* () {
        if (taskIds.length === 0) return;
        const records = yield* tasks.agentSessionsListForTasks({
          workspaceId: state.record.workspaceId,
          repoPath: state.record.repoPath,
          taskIds,
        });
        if (!state.active) return;
        const previous = [...state.taskOwners].filter(([, owner]) =>
          taskIds.includes(owner.taskId),
        );
        for (const [key] of previous) state.taskOwners.delete(key);
        const retained = new Set<string>();
        for (const { taskId, agentSessions } of records) {
          for (const session of agentSessions) {
            const key = agentSessionRefKey({ ...session, repoPath: state.record.repoPath });
            retained.add(key);
            state.taskOwners.set(key, {
              taskId,
              scope: {
                kind: "workflow",
                workspaceId: state.record.workspaceId,
                taskId,
                role: session.role,
              },
            });
          }
        }
        for (const [key] of previous)
          if (!retained.has(key)) state.projector.invalidateOwnership(key);
        yield* refreshOwners();
      });
    const autoCloseBlockedOccurrence = ({
      taskId,
      failedAt,
    }: TaskAutoCloseFailure): NotificationOccurrence => {
      const { workspaceId, repoPath, workspaceName } = state.record;
      const title = state.tasks.get(taskId)?.title;
      return {
        occurrenceId: `task.auto_close_blocked:${repoPath}:${taskId}:${failedAt}`,
        kind: "task.auto_close_blocked",
        workspaceId,
        repoPath,
        repositoryLabel: workspaceName,
        task: title ? { id: taskId, title } : { id: taskId },
        // The task shows the full reason, which can be longer than a notification.
        status: "Its pull request merged, but the task could not close. Open the task to see why.",
        navigationTarget: { type: "kanban_task", workspaceId, repoPath, taskId },
      };
    };
    const process = (input: WorkspaceNotificationInput) =>
      Effect.gen(function* () {
        if (!state.active) return;
        if (input.type === "auto_close_blocked") {
          yield* publish([autoCloseBlockedOccurrence(input.failure)]);
          return;
        }
        if (input.type === "association") {
          setWorkspaceSession(input.session);
          yield* refreshOwners();
          return;
        }
        if (input.type === "live") {
          // A fault reports a session or runtime read, and the session views show it.
          // The projector only marks the session status as unavailable.
          yield* publish(state.projector.accept(input.envelope, input.provenance));
          return;
        }
        const event = input.event;
        if (
          event.workspaceId !== state.record.workspaceId ||
          event.repoPath !== state.record.repoPath
        )
          return;
        if (event.kind === "external_task_created") {
          state.tasks.set(event.taskId, event.taskSnapshot);
          yield* refreshTaskOwners([event.taskId]);
          return;
        }
        for (const task of event.taskSnapshots) state.tasks.set(task.id, task);
        const projected = state.taskProjector.projectChange(event);
        if (!projected.accepted) return;
        for (const { task } of event.statusChanges) state.tasks.set(task.id, task);
        // Committed transitions remain eligible before any association read can fail.
        yield* publish(projected.occurrences);
        for (const taskId of event.removedTaskIds) {
          state.tasks.delete(taskId);
          for (const [key, owner] of state.taskOwners)
            if (owner.taskId === taskId) {
              state.taskOwners.delete(key);
              state.projector.invalidateOwnership(key);
            }
        }
        yield* refreshTaskOwners(event.taskIds.filter((id) => !event.removedTaskIds.includes(id)));
        yield* refreshOwners();
      });
    const consume = (input: WorkspaceNotificationInput) => {
      const report = (cause: unknown) =>
        Effect.sync(() => failure(state.record.repoPath, notificationInputSource(input), cause));
      return process(input).pipe(Effect.catch(report), Effect.catchDefect(report));
    };
    const initialize = () =>
      Effect.gen(function* () {
        const baseline = yield* tasks.listTasks({
          workspaceId: state.record.workspaceId,
          repoPath: state.record.repoPath,
        });
        if (!state.active) return;
        for (const task of baseline) state.tasks.set(task.id, task);
        yield* refreshTaskOwners(baseline.map(({ id }) => id));
        const sessions = yield* workspaceSessions.listActive(state.record);
        if (!state.active) return;
        for (const session of sessions) setWorkspaceSession(session);
        // Observe the workspace so the shared runtime restores its saved sessions when it starts.
        const snapshot = yield* live.attach({ repoPath: state.record.repoPath });
        if (!state.active) return;
        for (const session of snapshot.sessions) {
          // Captured live inputs, including removals, take precedence over read-derived state.
          if (!state.liveKeys.has(agentSessionRefKey(session.ref))) {
            yield* publish(state.projector.accept({ type: "session_upsert", session }, "baseline"));
          }
        }
        // Drain captured changes without ownership so resolved requests cannot alert.
        while (state.active) {
          const pending = yield* Queue.clear(state.queue);
          if (pending.length === 0) break;
          for (const input of pending) yield* consume(input);
        }
        if (!state.active) return;
        state.initialized = true;
        yield* refreshOwners();
        state.liveKeys.clear();
        recovered(state.record.repoPath);
      });
    // A failed baseline cannot observe changes. A config commit can create a fresh observer.
    const initializationFailed = (cause: unknown) =>
      Effect.sync(() => {
        state.active = false;
        failure(state.record.repoPath, "initialization", cause);
      });
    const enqueue = (input: WorkspaceNotificationInput) => {
      if (!state.active) return;
      if (!Queue.offerUnsafe(state.queue, input)) {
        state.active = false;
        failure(
          state.record.repoPath,
          notificationInputSource(input),
          new Error("Notification observation queue is full."),
        );
      }
    };
    return {
      isActive: () => state.active,
      updateRecord(next: WorkspaceRecord) {
        state.record = next;
        state.projector.setRepositoryLabel(next.workspaceName);
        state.taskProjector.setRepositoryLabel(next.workspaceName);
      },
      accept(input: WorkspaceNotificationInput) {
        if (!state.active) return;
        if (!state.initialized && input.type === "live" && input.provenance === "live") {
          const envelope = input.envelope;
          if (envelope.type === "session_upsert")
            state.liveKeys.add(agentSessionRefKey(envelope.session.ref));
          if (envelope.type === "session_removed")
            state.liveKeys.add(agentSessionRefKey(envelope.ref));
        }
        enqueue(input);
      },
      start: () =>
        Effect.gen(function* () {
          // Config writes cannot be interrupted, but the worker must stop when its workspace closes.
          state.fiber = yield* Effect.forkDetach(
            initialize().pipe(
              Effect.catch(initializationFailed),
              Effect.catchDefect(initializationFailed),
              Effect.andThen(
                Effect.suspend(() =>
                  state.active
                    ? Effect.forever(
                        Queue.take(queue).pipe(Effect.flatMap((input) => consume(input))),
                      )
                    : Effect.void,
                ),
              ),
              Effect.interruptible,
            ),
          );
        }),
      deactivate() {
        state.active = false;
      },
      dispose: () =>
        Effect.gen(function* () {
          state.active = false;
          if (state.fiber) yield* Fiber.interrupt(state.fiber);
          yield* Queue.shutdown(queue);
        }),
    };
  });
export type WorkspaceNotificationObserver = Effect.Success<
  ReturnType<typeof createWorkspaceNotificationObserver>
>;
