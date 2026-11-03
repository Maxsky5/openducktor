import {
  notificationOccurrenceSchema,
  notificationSettingsSchema,
  type AgentSessionLiveEnvelope,
  type ExternalTaskSyncEvent,
  type NotificationActionOccurrence,
  type NotificationOccurrence,
  type NotificationSettings,
  type SelectedNotification,
  type TaskAutoCloseFailure,
  type WorkspaceRecord,
  type WorkspaceRef,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { prepareNotificationOccurrence } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { SettingsConfigView, SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { openWorkspaceRecordsInEffectiveOrder } from "../workspaces/workspace-catalog-model";
import { createNotificationStream } from "./notification-stream";
import {
  createWorkspaceNotificationObserver,
  type WorkspaceNotificationObserver,
  type WorkspaceNotificationInput,
  notificationInputSource,
} from "./workspace-notification-observer";

export const createNotificationService = ({
  settingsConfig,
  taskWorkflows,
  tasks,
  live,
  workspaceSessions,
  boundIdentity,
}: {
  settingsConfig: SettingsConfigPort;
  taskWorkflows: TaskWorkflowResolver;
  tasks: Pick<TaskService, "listTasks" | "agentSessionsListForTasks">;
  live: Pick<AgentSessionLiveStateService, "attach">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "listActive">;
  boundIdentity(identity: string): string;
}) => {
  const stream = createNotificationStream();
  const workspaces = new Map<
    string,
    { record: WorkspaceRecord; observer: WorkspaceNotificationObserver }
  >();
  const selections = new Map<string, SelectedNotification>();
  let preferences: NotificationSettings | null = null;
  let preferenceRevision = 0;
  let stopped = false;
  let committedConfig: SettingsConfigView | null = null;
  let startup: "pending" | "starting" | "ready" = "pending";
  let startupInputs: Array<{ repoPath: string; input: WorkspaceNotificationInput }> = [];

  const failure = (
    scope: string,
    source: "initialization" | "task" | "session" | "settings",
    cause: unknown,
  ) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    const recovery =
      source === "initialization"
        ? "Fix the reported workspace error, then close and reopen the workspace or restart the host."
        : "Restart the host to restore notification observation.";
    stream.publishHealth({
      scope,
      source,
      message: `${message.slice(0, 850)} ${recovery}`,
    });
  };
  const captureStartup = (repoPath: string, input: WorkspaceNotificationInput) => {
    if (startupInputs.length >= 1024) {
      failure(
        repoPath,
        notificationInputSource(input),
        new Error("Notification startup queue is full."),
      );
      return;
    }
    startupInputs.push({ repoPath, input });
  };
  const select = (
    raw: NotificationOccurrence,
  ): Effect.Effect<SelectedNotification, HostOperationError> =>
    Effect.try({
      try: () => {
        if (stopped || !preferences)
          throw new Error("Notification preferences are unavailable. Restart the host.");
        const occurrence = notificationOccurrenceSchema.parse({
          ...prepareNotificationOccurrence(raw),
          occurrenceId: boundIdentity(raw.occurrenceId),
        });
        const previous = selections.get(occurrence.occurrenceId);
        if (previous) {
          if (JSON.stringify(previous.occurrence) !== JSON.stringify(occurrence)) {
            throw new Error(`Conflicting notification content for '${occurrence.occurrenceId}'.`);
          }
          return structuredClone(previous);
        }
        const selected = { occurrence, settings: structuredClone(preferences), preferenceRevision };
        selections.set(occurrence.occurrenceId, selected);
        if (selections.size > 256) {
          const oldest = selections.keys().next().value;
          if (oldest) selections.delete(oldest);
        }
        stream.publishOccurrence(selected);
        return structuredClone(selected);
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "notifications.select",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  const updateWorkspaces = (records: WorkspaceRecord[]) =>
    Effect.gen(function* () {
      const removed = [...workspaces.values()].filter(
        ({ record }) =>
          !records.some(
            (next) => next.workspaceId === record.workspaceId && next.repoPath === record.repoPath,
          ),
      );
      // Stop all removed observers before interrupting a worker, which can yield.
      for (const { record, observer } of removed) {
        observer.deactivate();
        workspaces.delete(record.workspaceId);
        for (const source of ["initialization", "task", "session"] as const)
          stream.publishHealth({ scope: record.repoPath, source, message: null });
      }
      for (const { observer } of removed) yield* observer.dispose();
      for (const record of records) {
        const existing = workspaces.get(record.workspaceId);
        if (existing?.observer.isActive()) {
          existing.record = record;
          existing.observer.updateRecord(record);
          continue;
        }
        if (existing) yield* existing.observer.dispose();
        const observer = yield* createWorkspaceNotificationObserver({
          record,
          taskWorkflows,
          tasks,
          live,
          workspaceSessions,
          select: (occurrence) => select(occurrence).pipe(Effect.asVoid),
          failure,
          recovered: (scope) =>
            stream.publishHealth({ scope, source: "initialization", message: null }),
        });
        workspaces.set(record.workspaceId, { record, observer });
        // Queue earlier inputs before starting the baseline read or accepting later live inputs.
        const pending = startupInputs;
        for (const entry of pending)
          if (
            entry.repoPath === record.repoPath &&
            (entry.input.type !== "task" || entry.input.event.workspaceId === record.workspaceId) &&
            (entry.input.type !== "live" ||
              !("workspaceId" in entry.input.envelope) ||
              entry.input.envelope.workspaceId === record.workspaceId)
          )
            observer.accept(entry.input);
        yield* observer.start();
      }
    });
  const acceptPreferences = (next: NotificationSettings) =>
    Effect.gen(function* () {
      if (stopped) return;
      const settings = yield* Effect.try({
        try: () => notificationSettingsSchema.removeDefault().parse(next),
        catch: (cause) =>
          new HostOperationError({
            operation: "notifications.preferences",
            message:
              "Notification preferences are invalid. Correct application settings and restart the host.",
            cause,
          }),
      });
      if (JSON.stringify(preferences) !== JSON.stringify(settings)) {
        preferences = structuredClone(settings);
        preferenceRevision += 1;
      }
    });
  const acceptConfig = (config: SettingsConfigView) =>
    Effect.gen(function* () {
      if (stopped) return;
      yield* acceptPreferences(config.notifications);
      if (startup !== "pending")
        yield* updateWorkspaces(openWorkspaceRecordsInEffectiveOrder(settingsConfig, config));
    });
  return {
    stream,
    initialize: () =>
      Effect.gen(function* () {
        const config = yield* settingsConfig.readConfig();
        startup = "starting";
        yield* acceptConfig(committedConfig ?? config);
        startupInputs.length = 0;
        startup = "ready";
      }).pipe(
        Effect.catch((cause) => Effect.sync(() => failure("application", "settings", cause))),
      ),
    configCommitted: (config: SettingsConfigView): Effect.Effect<void> =>
      Effect.gen(function* () {
        committedConfig = structuredClone(config);
        yield* acceptConfig(config).pipe(
          Effect.catch((cause) => Effect.sync(() => failure("application", "settings", cause))),
        );
      }),
    preferencesCommitted: (next: NotificationSettings): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (committedConfig) committedConfig = { ...committedConfig, notifications: next };
        yield* acceptPreferences(next).pipe(
          Effect.catch((cause) => Effect.sync(() => failure("application", "settings", cause))),
        );
      }),
    acceptTask(event: ExternalTaskSyncEvent) {
      if (stopped) return;
      const state = workspaces.get(event.workspaceId);
      if (state?.record.repoPath === event.repoPath) state.observer.accept({ type: "task", event });
      else if (startup !== "ready") captureStartup(event.repoPath, { type: "task", event });
    },
    acceptAutoCloseBlocked(workspace: WorkspaceRef, failure: TaskAutoCloseFailure) {
      if (stopped) return;
      const state = workspaces.get(workspace.workspaceId);
      const input: WorkspaceNotificationInput = { type: "auto_close_blocked", failure };
      if (state?.record.repoPath === workspace.repoPath) state.observer.accept(input);
      else if (startup !== "ready") captureStartup(workspace.repoPath, input);
    },
    acceptLive(envelope: AgentSessionLiveEnvelope, provenance: "baseline" | "live") {
      if (stopped) return;
      let path: string | null;
      if (envelope.type === "session_upsert") path = envelope.session.ref.repoPath;
      else if (envelope.type === "session_removed") path = envelope.ref.repoPath;
      else if (envelope.type === "transcript_event") path = envelope.event.sessionRef.repoPath;
      else path = "repoPath" in envelope ? envelope.repoPath : null;
      if (!path) return;
      const matches = [...workspaces.values()].filter(
        (state) =>
          state.record.repoPath === path &&
          (!("workspaceId" in envelope) || envelope.workspaceId === state.record.workspaceId),
      );
      if (matches.length === 0) {
        if (startup !== "ready") captureStartup(path, { type: "live", envelope, provenance });
        return;
      }
      for (const state of matches) state.observer.accept({ type: "live", envelope, provenance });
    },
    acceptWorkspaceSession(workspaceId: string, session: WorkspaceSession) {
      for (const state of workspaces.values())
        if (!stopped && state.record.workspaceId === workspaceId)
          state.observer.accept({ type: "association", session });
    },
    publishAction(
      occurrence: NotificationActionOccurrence,
      workspaceId?: string,
    ): Effect.Effect<SelectedNotification, HostError> {
      return Effect.gen(function* () {
        if (
          workspaceId !== undefined &&
          occurrence.workspaceId !== undefined &&
          workspaceId !== occurrence.workspaceId
        )
          return yield* new HostOperationError({
            operation: "notifications.action",
            message: "Notification workspace identities do not match. Reload the application.",
          });
        workspaceId ??=
          occurrence.workspaceId ??
          ("workspaceId" in occurrence.navigationTarget
            ? occurrence.navigationTarget.workspaceId
            : undefined);
        const candidates = [...workspaces.values()].filter(
          (state) =>
            state.record.repoPath === occurrence.repoPath &&
            (workspaceId === undefined || state.record.workspaceId === workspaceId),
        );
        if (candidates.length > 1)
          return yield* new HostOperationError({
            operation: "notifications.action",
            message:
              "Several workspaces use this repository. Publish the notification with its workspace identity.",
          });
        const state = candidates[0];
        if (!state?.observer.isActive())
          return yield* new HostOperationError({
            operation: "notifications.action",
            message: "The notification workspace is no longer open. Reopen the workspace.",
          });
        if (
          "repoPath" in occurrence.navigationTarget &&
          (occurrence.navigationTarget.repoPath !== occurrence.repoPath ||
            (occurrence.navigationTarget.workspaceId !== undefined &&
              occurrence.navigationTarget.workspaceId !== state.record.workspaceId))
        )
          return yield* new HostOperationError({
            operation: "notifications.action",
            message: "Notification navigation does not match its workspace.",
          });
        const target = occurrence.navigationTarget;
        if (
          (occurrence.kind === "agent.session_started" && target.type !== "agent_session") ||
          !["agent_session", "session_error", "agent_studio_task"].includes(target.type) ||
          (occurrence.task && (!("taskId" in target) || target.taskId !== occurrence.task.id))
        ) {
          return yield* new HostOperationError({
            operation: "notifications.action",
            message:
              "Notification action and navigation identities do not match. Reload the application.",
          });
        }
        const previous = selections.get(boundIdentity(occurrence.occurrenceId));
        return yield* select({
          ...occurrence,
          workspaceId: state.record.workspaceId,
          navigationTarget:
            occurrence.navigationTarget.type === "notification_settings"
              ? occurrence.navigationTarget
              : { ...occurrence.navigationTarget, workspaceId: state.record.workspaceId },
          repositoryLabel: previous?.occurrence.repositoryLabel ?? state.record.workspaceName,
        });
      });
    },
    dispose: () =>
      Effect.gen(function* () {
        stopped = true;
        startupInputs.length = 0;
        // Stop all observers before interrupting a worker, which can yield.
        for (const { observer } of workspaces.values()) observer.deactivate();
        for (const { observer } of workspaces.values()) yield* observer.dispose();
        workspaces.clear();
        selections.clear();
        yield* stream.dispose();
      }),
  };
};
export type NotificationService = ReturnType<typeof createNotificationService>;
