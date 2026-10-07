import {
  notificationOccurrenceSchema,
  notificationSettingsSchema,
  type AgentSessionLiveEnvelope,
  type ExternalTaskSyncEvent,
  type GlobalConfig,
  type NotificationActionOccurrence,
  type NotificationOccurrence,
  type NotificationSettings,
  type SelectedNotification,
  type WorkspaceRecord,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { prepareNotificationOccurrence } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { loadGlobalConfig } from "../workspaces/workspace-settings-model";
import { openWorkspaceRecordsInEffectiveOrder } from "../workspaces/workspace-catalog-model";
import { createNotificationStream } from "./notification-stream";
import {
  createWorkspaceNotificationObserver,
  type WorkspaceNotificationObserver,
  type WorkspaceNotificationInput,
} from "./workspace-notification-observer";

export const createNotificationService = ({
  settingsConfig,
  tasks,
  live,
  workspaceSessions,
  boundIdentity,
}: {
  settingsConfig: SettingsConfigPort;
  tasks: Pick<TaskService, "listTasks" | "agentSessionsListForTasks">;
  live: Pick<AgentSessionLiveStateService, "list" | "refresh">;
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
  let committedConfig: GlobalConfig | null = null;
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
        input.type === "task" ? "task" : "session",
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
      const paths = new Set(records.map(({ repoPath }) => repoPath));
      const removed = [...workspaces.values()].filter(({ record }) => !paths.has(record.repoPath));
      // Stop all removed observers before interrupting a worker, which can yield.
      for (const { record, observer } of removed) {
        observer.deactivate();
        workspaces.delete(record.repoPath);
        for (const source of ["initialization", "task", "session"] as const)
          stream.publishHealth({ scope: record.repoPath, source, message: null });
      }
      for (const { observer } of removed) yield* observer.dispose();
      for (const record of records) {
        const existing = workspaces.get(record.repoPath);
        if (existing?.observer.isActive()) {
          existing.record = record;
          existing.observer.updateRecord(record);
          continue;
        }
        if (existing) yield* existing.observer.dispose();
        const observer = yield* createWorkspaceNotificationObserver({
          record,
          tasks,
          live,
          workspaceSessions,
          select: (occurrence) => select(occurrence).pipe(Effect.asVoid),
          failure,
          recovered: (scope) =>
            stream.publishHealth({ scope, source: "initialization", message: null }),
        });
        workspaces.set(record.repoPath, { record, observer });
        // Queue earlier inputs before starting the baseline read or accepting later live inputs.
        const pending = startupInputs;
        startupInputs = pending.filter((entry) => entry.repoPath !== record.repoPath);
        for (const entry of pending)
          if (entry.repoPath === record.repoPath) observer.accept(entry.input);
        yield* observer.start();
      }
    });
  const acceptConfig = (config: GlobalConfig) =>
    Effect.gen(function* () {
      if (stopped) return;
      const settings = yield* Effect.try({
        try: () => notificationSettingsSchema.removeDefault().parse(config.notifications),
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
      if (startup !== "pending")
        yield* updateWorkspaces(openWorkspaceRecordsInEffectiveOrder(settingsConfig, config));
    });
  return {
    stream,
    initialize: () =>
      Effect.gen(function* () {
        const config = yield* loadGlobalConfig(settingsConfig);
        startup = "starting";
        yield* acceptConfig(committedConfig ?? config);
        startupInputs.length = 0;
        startup = "ready";
      }).pipe(
        Effect.catch((cause) => Effect.sync(() => failure("application", "settings", cause))),
      ),
    configCommitted: (config: GlobalConfig): Effect.Effect<void> =>
      Effect.gen(function* () {
        committedConfig = structuredClone(config);
        yield* acceptConfig(config).pipe(
          Effect.catch((cause) => Effect.sync(() => failure("application", "settings", cause))),
        );
      }),
    acceptTask(event: ExternalTaskSyncEvent) {
      if (stopped) return;
      const state = workspaces.get(event.repoPath);
      if (state) state.observer.accept({ type: "task", event });
      else if (startup !== "ready") captureStartup(event.repoPath, { type: "task", event });
    },
    acceptLive(envelope: AgentSessionLiveEnvelope, provenance: "baseline" | "live") {
      if (stopped) return;
      let path: string | null;
      if (envelope.type === "session_upsert") path = envelope.session.ref.repoPath;
      else if (envelope.type === "session_removed") path = envelope.ref.repoPath;
      else if (envelope.type === "transcript_event") path = envelope.event.sessionRef.repoPath;
      else path = "repoPath" in envelope ? envelope.repoPath : null;
      if (!path) return;
      const state = workspaces.get(path);
      if (!state) {
        if (startup !== "ready") captureStartup(path, { type: "live", envelope, provenance });
        return;
      }
      state.observer.accept({ type: "live", envelope, provenance });
    },
    acceptWorkspaceSession(workspaceId: string, session: WorkspaceSession) {
      for (const state of workspaces.values())
        if (!stopped && state.record.workspaceId === workspaceId)
          state.observer.accept({ type: "association", session });
    },
    publishAction(
      occurrence: NotificationActionOccurrence,
    ): Effect.Effect<SelectedNotification, HostError> {
      return Effect.gen(function* () {
        const state = workspaces.get(occurrence.repoPath);
        if (!state?.observer.isActive())
          return yield* new HostOperationError({
            operation: "notifications.action",
            message: "The notification workspace is no longer open. Reopen the workspace.",
          });
        if (
          "repoPath" in occurrence.navigationTarget &&
          occurrence.navigationTarget.repoPath !== occurrence.repoPath
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
