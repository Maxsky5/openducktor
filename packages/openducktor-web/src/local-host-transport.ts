import {
  notificationStreamSubscribeSchema,
  type AgentSessionLiveAttachInput,
  type AgentSessionLiveEnvelope,
  type HostErrorResponse,
  type HostEventChannel,
  type HostEventPayload,
  type NotificationCursor,
  type RemoteAccessState,
  type TaskEventCursor,
} from "@openducktor/contracts";
import type { HostCommandArgs, HostCommandName } from "@openducktor/host";
import type { AzureDevOpsConnectionUpdateListener, RunEventListener } from "@openducktor/frontend";
import { CONNECTION_RECONNECTED_EVENT_KIND } from "@openducktor/frontend-core/recovery/connection-control-events";
import { connectionStreamWarningEvent } from "@openducktor/frontend-core/recovery/connection-control-events";
import type {
  BrowserTabEventListener,
  RuntimeChangeListener,
  TaskMergeStatusUpdateListener,
  StartupProgressListener,
  TaskStreamFrame,
  TaskStreamSubscription,
} from "@openducktor/frontend-core/connection/host-connection";
import {
  createAgentSessionLiveAttachment,
  createHostClient,
  type HostClient,
  HostInvokeError,
  type InvokeFn,
} from "@openducktor/host-client";
import { HostChannelRequestError } from "@openducktor/host-client/channel";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { getBrowserAuthTokenEffect, getBrowserBackendUrlEffect } from "./browser-config";
import {
  causeToWebBoundaryError,
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebHostRequestError,
} from "@openducktor/remote-host/effect/web-errors";
import { readLocalHostErrorPayloadEffect } from "./local-host-errors";
import {
  BROWSER_EVENT_STREAM_NAME,
  STARTUP_EVENT_STREAM_NAME,
  liveSessionStreamEventName,
} from "@openducktor/remote-host/host-event-stream-name";
import {
  createLocalHostChannel,
  type LocalHostChannel,
  type LocalHostChannelEvent,
  type LocalHostChannelListener,
} from "./local-host-channel";
import type { ConnectionControlEvent } from "@openducktor/frontend-core/recovery/connection-control-events";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL = "openducktor://azure-devops-connection-updated";
const RUNTIME_CHANGED_EVENT_CHANNEL = "openducktor://runtime-changed";
const TASK_MERGE_STATUS_EVENT_CHANNEL = "openducktor://task-merge-status-updated";
const BROWSER_EVENT_CHANNEL = "openducktor://browser-event";
const HOST_CHANNEL_PATH = "channel";
export const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";
const INITIAL_CHANNEL_READY_TIMEOUT_MS = 10_000;
const DEFAULT_EVENT_NAME = "message";

type LocalHostRequestErrorInput = {
  message: string;
  status: number;
  cause?: HostErrorResponse;
  failureKind?: string;
};

const isControlEvent = (event: LocalHostChannelEvent): event is ConnectionControlEvent =>
  "__openducktorConnectionControl" in event;

let channel: LocalHostChannel | null = null;
let sessionPromise: Promise<void> | null = null;

const createLocalHostRequestError = (
  response: Response,
  message: string,
  payload: HostErrorResponse | null,
): WebHostRequestError => {
  const input: LocalHostRequestErrorInput = { message, status: response.status };
  if (payload !== null) {
    input.cause = payload;
  }
  if (payload?.failureKind) {
    input.failureKind = payload.failureKind;
  }
  return new WebHostRequestError(input);
};

const localHostRequestErrorEffect = (
  response: Response,
): Effect.Effect<never, WebDependencyError | WebHostRequestError> =>
  Effect.gen(function* () {
    const { message, payload } = yield* readLocalHostErrorPayloadEffect(response);
    return yield* createLocalHostRequestError(response, message, payload);
  });

export const ensureLocalHostSessionEffect = (): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    const appToken = yield* getBrowserAuthTokenEffect();
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/${SESSION_PATH}`, {
          method: "POST",
          credentials: "include",
          headers: {
            [APP_TOKEN_HEADER]: appToken,
          },
        }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "session",
          message: errorMessage(cause),
          cause,
        }),
    });

    if (!response.ok) {
      return yield* localHostRequestErrorEffect(response);
    }
  });

export const ensureLocalHostSession = (): Promise<void> => {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = runWebBoundary(ensureLocalHostSessionEffect()).catch((cause: unknown) => {
    sessionPromise = null;
    throw cause;
  });

  return sessionPromise;
};

export const ensureLocalHostSessionDedupedEffect = (): Effect.Effect<void, WebError> =>
  Effect.tryPromise({
    try: () => ensureLocalHostSession(),
    catch: (cause) =>
      isWebError(cause)
        ? cause
        : new WebDependencyError({
            dependency: "local-web-host",
            operation: "session",
            message: errorMessage(cause),
            cause,
          }),
  });

const channelSocketUrl = (backendUrl: string): string => {
  const url = new URL(`${backendUrl.replace(/\/$/, "")}/${HOST_CHANNEL_PATH}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

/** The host channel of this tab. It closes when nothing uses it, and the next use opens a new one. */
const localHostChannel = (
  notificationCursor: NotificationCursor | null = null,
): LocalHostChannel => {
  if (channel) return channel;
  const created = createLocalHostChannel({
    prepare: async () => {
      await ensureLocalHostSession();
      return channelSocketUrl(await runWebBoundary(getBrowserBackendUrlEffect()));
    },
    createSocket: (url, protocols) => new WebSocket(url, protocols),
    notificationCursor,
    onDispose: () => {
      if (channel === created) channel = null;
    },
  });
  channel = created;
  return created;
};

/** The web error of a failed channel request. */
const localChannelError = (
  cause: unknown,
  operation: string,
): WebError | HostInvokeError | WebHostRequestError => {
  if (cause instanceof HostChannelRequestError) {
    const { error } = cause;
    if (error.kind === "host") {
      if (error.response.failure) return new HostInvokeError(cause.message, error.response.failure);
      const input: LocalHostRequestErrorInput = {
        message: cause.message,
        status: 500,
        cause: error.response,
      };
      if (error.response.failureKind) input.failureKind = error.response.failureKind;
      return new WebHostRequestError(input);
    }
    return new WebHostRequestError({
      message: cause.message,
      status: error.kind === "refused" ? 503 : 500,
    });
  }
  if (isWebError(cause) || cause instanceof HostInvokeError) return cause;
  return new WebDependencyError({
    dependency: "local-web-host",
    operation,
    message: errorMessage(cause),
    cause,
  });
};

const invokeLocalHost = async (
  command: HostCommandName,
  args: HostCommandArgs,
  signal: AbortSignal | undefined,
): Promise<JSONType> => {
  try {
    return await localHostChannel().request(
      { method: "invoke", command, args: args ?? {} },
      signal,
    );
  } catch (cause) {
    // The caller stopped waiting. The host may still run the command.
    if (signal?.aborted && cause === signal.reason) throw cause;
    throw localChannelError(cause, "invoke");
  }
};

const createChannelInvoke = (): InvokeFn => async (command, args, resultSchema, options) =>
  resultSchema.parse(await invokeLocalHost(command, args, options?.signal));

export const createLocalHostClient = (): HostClient => createHostClient(createChannelInvoke());

/** Adds a listener and waits until the channel finished its first replay. */
const subscribeReadyLocalHostEventsEffect = (
  eventChannel: HostEventChannel,
  listener: LocalHostChannelListener,
  eventName = DEFAULT_EVENT_NAME,
): Effect.Effect<() => void, WebError> =>
  Effect.gen(function* () {
    yield* ensureLocalHostSessionDedupedEffect();
    const current = localHostChannel();
    const registration = {
      channel: eventChannel,
      eventName,
      listener,
      receivesControlEvents: true,
    };
    let active = true;
    const remove = current.addListener(registration);
    const unsubscribe = () => {
      active = false;
      remove();
    };
    const readyExit = yield* Effect.exit(
      Effect.tryPromise({
        try: async () => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () =>
                reject(
                  new WebDependencyError({
                    dependency: "host-channel",
                    operation: "await-ready",
                    message: "Timed out waiting for the host channel to open.",
                    details: {
                      path: HOST_CHANNEL_PATH,
                      timeoutMs: INITIAL_CHANNEL_READY_TIMEOUT_MS,
                    },
                  }),
                ),
              INITIAL_CHANNEL_READY_TIMEOUT_MS,
            );
          });
          try {
            await Promise.race([current.ready, timeout]);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          // The first open does not prove the channel is connected now. A control subscriber that
          // joins during a connection failure gets that failure before its subscription is ready.
          const warning = current.readConnectionWarning();
          if (active && warning !== null) {
            await listener(connectionStreamWarningEvent(warning));
          }
        },
        catch: (cause) =>
          isWebError(cause)
            ? cause
            : new WebDependencyError({
                dependency: "host-channel",
                operation: "await-ready",
                message: errorMessage(cause),
                cause,
                details: { path: HOST_CHANNEL_PATH },
              }),
      }),
    );
    if (readyExit._tag === "Failure") {
      unsubscribe();
      return yield* causeToWebBoundaryError(readyExit.cause);
    }
    return unsubscribe;
  });

const subscribeReadyLocalHostEvents = (
  eventChannel: HostEventChannel,
  listener: LocalHostChannelListener,
  eventName = DEFAULT_EVENT_NAME,
): Promise<() => void> =>
  runWebBoundary(subscribeReadyLocalHostEventsEffect(eventChannel, listener, eventName));

export const subscribeLocalHostRunEvents = (listener: RunEventListener): Promise<() => void> =>
  // Control events report reconnects, so a listener can read the state that it missed.
  subscribeReadyLocalHostEvents(RUN_EVENT_CHANNEL, (event) => {
    if (isControlEvent(event)) return listener(event);
    if (event.channel === RUN_EVENT_CHANNEL) return listener(event.payload);
  });

export const subscribeLocalHostAzureDevOpsConnectionUpdates = (
  listener: AzureDevOpsConnectionUpdateListener,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents(AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL, (event) => {
    if (!isControlEvent(event) && event.channel === AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL)
      listener(event.payload);
  });

export const subscribeLocalHostWorkspaceProviderSetupUpdates = (
  listener: (payload: HostEventPayload<"openducktor://workspace-provider-setup-updated">) => void,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents("openducktor://workspace-provider-setup-updated", (event) => {
    if (
      !isControlEvent(event) &&
      event.channel === "openducktor://workspace-provider-setup-updated"
    )
      listener(event.payload);
  });

export const subscribeLocalHostWorkspaceSessionUpdates = (
  listener: import("@openducktor/frontend-core/connection/host-connection").WorkspaceSessionUpdateListener,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents("openducktor://workspace-session-updated", (event) => {
    if (isControlEvent(event)) return listener(event);
    if (event.channel === "openducktor://workspace-session-updated") return listener(event.payload);
  });

export const subscribeLocalHostStartupProgress = (
  listener: StartupProgressListener,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents(
    "openducktor://session-startup-progress",
    (event) => {
      if (isControlEvent(event) || event.channel === "openducktor://session-startup-progress")
        return listener(event);
    },
    STARTUP_EVENT_STREAM_NAME,
  );

export const subscribeLocalHostRuntimeChanges = (
  listener: RuntimeChangeListener,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents(RUNTIME_CHANGED_EVENT_CHANNEL, (event) => {
    if (isControlEvent(event)) return listener(event);
    if (event.channel === RUNTIME_CHANGED_EVENT_CHANNEL) return listener(event.payload);
  });

export const subscribeLocalHostTaskMergeStatusUpdates = (
  listener: TaskMergeStatusUpdateListener,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents(TASK_MERGE_STATUS_EVENT_CHANNEL, (event) => {
    if (isControlEvent(event)) return listener(event);
    if (event.channel === TASK_MERGE_STATUS_EVENT_CHANNEL) return listener(event.payload);
  });

export const subscribeLocalHostBrowserTabEvents = (
  listener: BrowserTabEventListener,
): Promise<() => void> =>
  subscribeReadyLocalHostEvents(
    BROWSER_EVENT_CHANNEL,
    (event) => {
      if (isControlEvent(event)) return listener(event);
      if (event.channel === BROWSER_EVENT_CHANNEL) return listener(event.payload);
    },
    BROWSER_EVENT_STREAM_NAME,
  );

export const observeLocalHostAgentSessions = async (
  input: AgentSessionLiveAttachInput,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      const client = createLocalHostClient();
      let closed = false;
      // Each attach request takes a new generation. Only the latest one can install its snapshot.
      let attachGeneration = 0;
      const nextAttachGeneration = (): number => {
        attachGeneration += 1;
        return attachGeneration;
      };
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const attach = async (generation: number): Promise<void> => {
        const snapshot = await client.agentSessionLiveAttach(input);
        if (!closed && generation === attachGeneration) attachment.install(snapshot);
      };
      // A complete replay keeps the current state. Missed events need a new host snapshot.
      const reattach = (): void => {
        const generation = nextAttachGeneration();
        attachment.restart();
        attach(generation).catch((cause: unknown) => {
          if (!closed && generation === attachGeneration) {
            listener({
              type: "fault",
              repoPath: input.repoPath,
              operation: "agent-session-live.attach",
              message: errorMessage(cause),
            } satisfies AgentSessionLiveEnvelope);
          }
        });
      };
      const unsubscribe = yield* subscribeReadyLocalHostEventsEffect(
        AGENT_SESSION_LIVE_EVENT_CHANNEL,
        (event) => {
          if (isControlEvent(event)) {
            if (event.kind === CONNECTION_RECONNECTED_EVENT_KIND && event.missedEvents) {
              reattach();
            }
            return;
          }
          if (event.channel === AGENT_SESSION_LIVE_EVENT_CHANNEL) {
            attachment.accept(event.payload);
          }
        },
        liveSessionStreamEventName(input.repoPath),
      );
      const initialAttachExit = yield* Effect.exit(
        Effect.tryPromise({
          // A recovery before the first open can already have started a newer request.
          try: () => attach(nextAttachGeneration()),
          catch: (cause) =>
            isWebError(cause)
              ? cause
              : new WebDependencyError({
                  dependency: "local-web-host",
                  operation: "agent-session-live.attach",
                  message: errorMessage(cause),
                  cause,
                }),
        }),
      );
      if (initialAttachExit._tag === "Failure") {
        unsubscribe();
        return yield* causeToWebBoundaryError(initialAttachExit.cause);
      }
      return () => {
        closed = true;
        unsubscribe();
      };
    }),
  );
};

export const subscribeLocalHostTaskStream = async (
  input: { cursor: TaskEventCursor | null },
  onFrame: (frame: TaskStreamFrame) => void,
  onTerminalFailure?: (cause: unknown) => void,
): Promise<TaskStreamSubscription> => {
  await ensureLocalHostSession();
  const current = localHostChannel();
  let subscription: Awaited<ReturnType<LocalHostChannel["subscribeTaskEvents"]>>;
  try {
    subscription = await current.subscribeTaskEvents(input, onFrame, onTerminalFailure);
  } catch (cause) {
    throw localChannelError(cause, "task-event-stream.subscribe");
  }
  return {
    subscriptionId: subscription.subscriptionId,
    acknowledge: async (cursor) => {
      try {
        await subscription.acknowledge(cursor);
      } catch (cause) {
        throw localChannelError(cause, "task-event-stream.acknowledge");
      }
    },
    unsubscribe: () => subscription.unsubscribe(),
  };
};

/** Delivers the live remote access state of the local operator. */
export const observeLocalHostRemoteAccess = async (
  listener: (state: RemoteAccessState) => void,
): Promise<() => void> => {
  await ensureLocalHostSession();
  return localHostChannel().observeRemoteAccess(listener);
};

export const buildLocalAttachmentPreviewUrl = (browserBackendUrl: string, path: string): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const query = new URLSearchParams({ path });
  return `${baseUrl}/local-attachment-preview?${query.toString()}`;
};

export const buildTaskAssetUrl = (
  browserBackendUrl: string,
  input: { workspaceId: string; taskId: string; scope: string; assetId: string },
): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const segments = [input.workspaceId, input.taskId, input.scope, input.assetId].map((segment) =>
    encodeURIComponent(segment),
  );
  return `${baseUrl}/task-assets/${segments.join("/")}`;
};

export const subscribeLocalHostNotificationStream: import("@openducktor/frontend-core/connection/host-connection").HostConnection["subscribeNotificationStream"] =
  (input, onFrame, onFailure) =>
    runWebBoundary(
      Effect.gen(function* () {
        const parsed = notificationStreamSubscribeSchema.parse(input);
        yield* ensureLocalHostSessionDedupedEffect();
        const current = localHostChannel(parsed.cursor);
        return current.subscribeNotifications(parsed, onFrame, onFailure);
      }),
    );
