import type {
  AgentSessionScope,
  NotificationOccurrence,
  TaskEventTaskSnapshot,
  WorkspaceRecord,
  WorkspaceSession,
  ExternalTaskSyncEvent,
  AgentSessionLiveEnvelope,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { createSessionOccurrenceProjector } from "./session-occurrence-projector";
import { createTaskOccurrenceProjector } from "./task-occurrence-projector";
import { Effect, Fiber, Queue } from "effect";
import type { HostOperationError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
export type WorkspaceNotificationInput =
  | { type: "task"; event: ExternalTaskSyncEvent }
  | { type: "live"; envelope: AgentSessionLiveEnvelope; provenance: "baseline" | "live" }
  | { type: "association"; session: WorkspaceSession };
type WorkspaceState = {
  record: WorkspaceRecord;
  active: boolean;
  queue: Queue.Queue<WorkspaceNotificationInput>;
  fiber: Fiber.RuntimeFiber<void, never> | null;
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
  tasks,
  live,
  workspaceSessions,
  select,
  failure,
  recovered,
}: {
  record: WorkspaceRecord;
  tasks: Pick<TaskService, "listTasks" | "agentSessionsListForTasks">;
  live: Pick<AgentSessionLiveStateService, "list">;
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
          return state.workspaceOwners.has(key) ? { kind: "repository" } : null;
        },
      }),
    };
    const publish = (occurrences: NotificationOccurrence[]) =>
      Effect.forEach(
        occurrences,
        (occurrence) => Effect.suspend(() => (state.active ? select(occurrence) : Effect.void)),
        { discard: true },
      );
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
              scope: { kind: "workflow", taskId, role: session.role },
            });
          }
        }
        for (const [key] of previous)
          if (!retained.has(key)) state.projector.invalidateOwnership(key);
        yield* refreshOwners();
      });
    const process = (input: WorkspaceNotificationInput) =>
      Effect.gen(function* () {
        if (!state.active) return;
        if (input.type === "association") {
          setWorkspaceSession(input.session);
          yield* refreshOwners();
          return;
        }
        if (input.type === "live") {
          if (input.envelope.type === "fault") {
            failure(state.record.repoPath, "session", new Error(input.envelope.message));
            return;
          }
          yield* publish(state.projector.accept(input.envelope, input.provenance));
          return;
        }
        const event = input.event;
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
    const consume = (input: WorkspaceNotificationInput) =>
      process(input).pipe(
        Effect.catchAll((cause) =>
          Effect.sync(() =>
            failure(state.record.repoPath, input.type === "task" ? "task" : "session", cause),
          ),
        ),
      );
    const initialize = () =>
      Effect.gen(function* () {
        const baseline = yield* tasks.listTasks({ repoPath: state.record.repoPath });
        if (!state.active) return;
        for (const task of baseline) state.tasks.set(task.id, task);
        yield* refreshTaskOwners(baseline.map(({ id }) => id));
        const sessions = yield* workspaceSessions.listActive(state.record);
        if (!state.active) return;
        for (const session of sessions) setWorkspaceSession(session);
        const snapshots = yield* live.list({ repoPath: state.record.repoPath });
        if (!state.active) return;
        for (const session of snapshots) {
          // Captured live inputs, including removals, take precedence over read-derived state.
          if (!state.liveKeys.has(agentSessionRefKey(session.ref))) {
            yield* publish(state.projector.accept({ type: "session_upsert", session }, "baseline"));
          }
        }
        // Drain captured changes without ownership so resolved requests cannot alert.
        while (state.active) {
          const pending = yield* Queue.takeAll(state.queue);
          if (pending.length === 0) break;
          for (const input of pending) yield* consume(input);
        }
        if (!state.active) return;
        state.initialized = true;
        yield* refreshOwners();
        state.liveKeys.clear();
        recovered(state.record.repoPath);
      });
    const enqueue = (input: WorkspaceNotificationInput) => {
      if (!state.active) return;
      if (!Effect.runSync(Queue.offer(state.queue, input))) {
        state.active = false;
        failure(
          state.record.repoPath,
          input.type === "task" ? "task" : "session",
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
          state.fiber = yield* Effect.forkDaemon(
            initialize().pipe(
              Effect.catchAll((cause) =>
                Effect.sync(() => {
                  // A failed baseline cannot observe changes. A config commit can create a fresh observer.
                  state.active = false;
                  failure(state.record.repoPath, "initialization", cause);
                }),
              ),
              Effect.zipRight(
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
export type WorkspaceNotificationObserver = Effect.Effect.Success<
  ReturnType<typeof createWorkspaceNotificationObserver>
>;
