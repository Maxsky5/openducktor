import {
  type TaskEventCursor,
  taskEventCursorSchema,
  taskEventStreamFrameSchema,
} from "@openducktor/contracts";
import type {
  TaskStreamFrame,
  TaskStreamSubscription,
} from "@openducktor/frontend/lib/shell-bridge";
import { Effect } from "effect";
import { getBrowserAuthTokenEffect, getBrowserBackendUrlEffect } from "./browser-config";
import {
  causeToWebBoundaryError,
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  type WebHostRequestError,
} from "./effect/web-errors";

const APP_TOKEN_HEADER = "x-openducktor-app-token";
const TASK_STREAM_TOKEN_HEADER = "x-openducktor-task-stream-token";
const TASK_EVENT_SUBSCRIPTIONS_PATH = "task-events/subscriptions";
const INITIAL_SSE_READY_TIMEOUT_MS = 10_000;

type LocalTaskEventTransportContext = {
  ensureSession: () => Effect.Effect<void, WebError>;
  localHostRequestErrorEffect: (
    response: Response,
  ) => Effect.Effect<never, WebDependencyError | WebHostRequestError>;
};

const parseTaskEventSubscription = (
  value: unknown,
): { subscriptionId: string; streamToken: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task event stream subscription response must be an object.");
  }
  const { streamToken, subscriptionId } = value as Record<string, unknown>;
  if (
    typeof streamToken !== "string" ||
    streamToken.length === 0 ||
    typeof subscriptionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      subscriptionId,
    )
  ) {
    throw new Error("Task event stream subscription response is invalid.");
  }
  return { streamToken, subscriptionId };
};

export const subscribeLocalTaskEventStreamEffect = (
  input: { cursor: TaskEventCursor | null },
  onFrame: (frame: TaskStreamFrame) => void,
  onTerminalFailure: ((error: unknown) => void) | undefined,
  { ensureSession, localHostRequestErrorEffect }: LocalTaskEventTransportContext,
): Effect.Effect<TaskStreamSubscription, WebError> =>
  Effect.gen(function* () {
    const cursor = yield* Effect.try({
      try: () => (input.cursor === null ? null : taskEventCursorSchema.parse(input.cursor)),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "task-event-stream",
          operation: "validate-subscribe",
          message: errorMessage(cause),
          cause,
        }),
    });
    yield* ensureSession();
    const appToken = yield* getBrowserAuthTokenEffect();
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    const createResponse = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/${TASK_EVENT_SUBSCRIPTIONS_PATH}`, {
          body: JSON.stringify({ cursor }),
          credentials: "include",
          headers: { "content-type": "application/json", [APP_TOKEN_HEADER]: appToken },
          method: "POST",
        }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "task-event-stream.create",
          message: errorMessage(cause),
          cause,
        }),
    });
    if (!createResponse.ok) {
      return yield* localHostRequestErrorEffect(createResponse);
    }
    const created = yield* Effect.tryPromise({
      try: async () => parseTaskEventSubscription(await createResponse.json()),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "task-event-stream.parse-create-response",
          message: errorMessage(cause),
          cause,
        }),
    });
    const streamUrl = new URL(
      `${baseUrl}/${TASK_EVENT_SUBSCRIPTIONS_PATH}/${created.subscriptionId}/stream`,
    );
    streamUrl.searchParams.set("token", created.streamToken);
    const deleteLeaseBestEffort = async (): Promise<void> => {
      try {
        await fetch(`${baseUrl}/${TASK_EVENT_SUBSCRIPTIONS_PATH}/${created.subscriptionId}`, {
          credentials: "include",
          headers: {
            [APP_TOKEN_HEADER]: appToken,
            [TASK_STREAM_TOKEN_HEADER]: created.streamToken,
          },
          method: "DELETE",
        });
      } catch {
        // Preserve the stream setup failure when lease cleanup also fails.
      }
    };
    const eventSource = yield* Effect.tryPromise({
      try: async () => {
        try {
          return new EventSource(streamUrl, { withCredentials: true });
        } catch (cause) {
          await deleteLeaseBestEffort();
          throw cause;
        }
      },
      catch: (cause) =>
        new WebDependencyError({
          dependency: "event-source",
          operation: "task-event-stream.subscribe",
          message: errorMessage(cause),
          cause,
        }),
    });
    let subscriptionReady = false;
    let closed = false;
    let unsubscribed = false;
    let terminalFailureReported = false;
    let unsubscribePromise: Promise<void> | null = null;
    const pendingFrames: TaskStreamFrame[] = [];
    let resolveInitialReadiness: () => void = () => {};
    let rejectInitialReadiness: (cause: WebDependencyError) => void = () => {};
    let hasInitialReadiness = false;
    const initialReadiness = new Promise<void>((resolve, reject) => {
      resolveInitialReadiness = resolve;
      rejectInitialReadiness = reject;
    });
    const markInitialReadiness = (): void => {
      if (hasInitialReadiness) {
        return;
      }
      hasInitialReadiness = true;
      resolveInitialReadiness();
    };
    const handleOpen = (): void => {
      markInitialReadiness();
    };
    const handleError = (): void => {
      if (!hasInitialReadiness) {
        if (eventSource.readyState === EventSource.CLOSED) {
          rejectInitialReadiness(
            new WebDependencyError({
              dependency: "event-source",
              operation: "task-event-stream.await-ready",
              message: "Task event stream closed before its initial connection was ready.",
              details: { path: streamUrl.pathname },
            }),
          );
        }
        return;
      }
      if (eventSource.readyState === EventSource.CLOSED) {
        reportTerminalFailure(
          new WebDependencyError({
            dependency: "event-source",
            operation: "task-event-stream.terminal",
            message: "Task event stream closed after initial readiness.",
            details: { path: streamUrl.pathname },
          }),
        );
      }
    };
    const reportTerminalFailure = (failure: unknown): void => {
      if (unsubscribed || terminalFailureReported) {
        return;
      }
      terminalFailureReported = true;
      onTerminalFailure?.(failure);
    };
    const handleFrame = (event: MessageEvent<string>): void => {
      if (closed) return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch (cause) {
        const failure = new WebDependencyError({
          dependency: "task-event-stream",
          operation: "parse-frame",
          message: `OpenDucktor task event stream received invalid JSON: ${errorMessage(cause)}`,
          cause,
        });
        if (!hasInitialReadiness) {
          rejectInitialReadiness(failure);
        } else {
          reportTerminalFailure(failure);
        }
        return;
      }
      const parsed = taskEventStreamFrameSchema.safeParse(raw);
      if (!parsed.success) {
        const failure = new WebDependencyError({
          dependency: "task-event-stream",
          operation: "validate-frame",
          message: "OpenDucktor task event stream received an invalid frame.",
          cause: parsed.error,
        });
        if (!hasInitialReadiness) {
          rejectInitialReadiness(failure);
        } else {
          reportTerminalFailure(failure);
        }
        return;
      }
      if (!subscriptionReady) {
        pendingFrames.push(parsed.data);
      } else {
        onFrame(parsed.data);
      }
      markInitialReadiness();
    };
    eventSource.addEventListener("task-frame", handleFrame as EventListener);
    eventSource.addEventListener("open", handleOpen as EventListener);
    eventSource.addEventListener("error", handleError as EventListener);
    const initialReadyExit = yield* Effect.exit(
      Effect.tryPromise({
        try: () => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () =>
                reject(
                  new WebDependencyError({
                    dependency: "event-source",
                    operation: "task-event-stream.await-ready",
                    message: "Timed out waiting for task event stream subscription to open.",
                    details: {
                      path: streamUrl.pathname,
                      timeoutMs: INITIAL_SSE_READY_TIMEOUT_MS,
                    },
                  }),
                ),
              INITIAL_SSE_READY_TIMEOUT_MS,
            );
          });
          return Promise.race([initialReadiness, timeout]).finally(() => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          });
        },
        catch: (cause) =>
          isWebError(cause)
            ? cause
            : new WebDependencyError({
                dependency: "event-source",
                operation: "task-event-stream.await-ready",
                message: errorMessage(cause),
                cause,
                details: { path: streamUrl.pathname },
              }),
      }),
    );
    if (initialReadyExit._tag === "Failure") {
      closed = true;
      eventSource.removeEventListener("task-frame", handleFrame as EventListener);
      eventSource.removeEventListener("open", handleOpen as EventListener);
      eventSource.removeEventListener("error", handleError as EventListener);
      eventSource.close();
      yield* Effect.promise(deleteLeaseBestEffort);
      return yield* causeToWebBoundaryError(initialReadyExit.cause);
    }
    const request = async (
      path: string,
      init: Omit<RequestInit, "headers"> & { headers?: HeadersInit },
    ): Promise<Response> => {
      const response = await fetch(`${baseUrl}/${path}`, {
        ...init,
        credentials: "include",
        headers: { [APP_TOKEN_HEADER]: appToken, ...init.headers },
      });
      if (!response.ok) {
        await runWebBoundary(localHostRequestErrorEffect(response));
      }
      return response;
    };
    const subscription: TaskStreamSubscription = {
      subscriptionId: created.subscriptionId,
      acknowledge: async (acknowledgedCursor) => {
        const validCursor = taskEventCursorSchema.parse(acknowledgedCursor);
        await request(`${TASK_EVENT_SUBSCRIPTIONS_PATH}/${created.subscriptionId}/ack`, {
          body: JSON.stringify({ cursor: validCursor }),
          headers: {
            "content-type": "application/json",
            [TASK_STREAM_TOKEN_HEADER]: created.streamToken,
          },
          method: "POST",
        });
      },
      unsubscribe: () => {
        if (!unsubscribePromise) {
          unsubscribed = true;
          closed = true;
          eventSource.close();
          unsubscribePromise = request(
            `${TASK_EVENT_SUBSCRIPTIONS_PATH}/${created.subscriptionId}`,
            {
              headers: { [TASK_STREAM_TOKEN_HEADER]: created.streamToken },
              method: "DELETE",
            },
          ).then(() => undefined);
        }
        return unsubscribePromise;
      },
    };
    subscriptionReady = true;
    for (const frame of pendingFrames) {
      if (!closed) onFrame(frame);
    }
    return subscription;
  });
