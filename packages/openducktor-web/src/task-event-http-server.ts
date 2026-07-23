import { createHmac, timingSafeEqual } from "node:crypto";
import { taskEventCursorSchema, taskEventStreamSubscribeSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, WebHostRequestError } from "./effect/web-errors";
import type { TaskEventLeaseManager } from "./task-event-leases";

export const TASK_EVENT_STREAM_TOKEN_HEADER = "x-openducktor-task-stream-token";
const TASK_EVENT_SUBSCRIPTIONS_PATH = "/task-events/subscriptions";

type RequestTimeoutController = {
  timeout(request: Request, seconds: number): void;
};

type TaskEventHttpServerContext = {
  appToken: string;
  controlToken: string;
  corsHeaders: HeadersInit;
  parseJsonObjectBody: (
    request: Request,
  ) => Effect.Effect<Record<string, unknown>, WebHostRequestError>;
  request: Request;
  requestTimeouts?: RequestTimeoutController | undefined;
  shutdownStarted: boolean;
  taskEventLeaseManager?: TaskEventLeaseManager;
  validateAppCookieOrHeader: (
    request: Request,
    expectedToken: string,
  ) => Effect.Effect<void, WebHostRequestError>;
  validateAppSessionCookie: (
    request: Request,
    expectedToken: string,
  ) => Effect.Effect<void, WebHostRequestError>;
};

const reject = (message: string, status: number): Effect.Effect<never, WebHostRequestError> =>
  Effect.fail(new WebHostRequestError({ message, status }));

const jsonResponse = (payload: unknown, init: ResponseInit, corsHeaders: HeadersInit): Response =>
  new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...init.headers,
    },
  });

const taskEventStreamCapability = (controlToken: string, subscriptionId: string): string =>
  createHmac("sha256", controlToken)
    .update(`task-event-stream:v1:${subscriptionId}`)
    .digest("base64url");

const isValidTaskEventStreamCapability = (
  controlToken: string,
  subscriptionId: string,
  receivedToken: string | null,
): boolean => {
  if (!receivedToken) return false;
  const expected = Buffer.from(taskEventStreamCapability(controlToken, subscriptionId));
  const received = Buffer.from(receivedToken);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
};

const isPublicSubscriptionId = (subscriptionId: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subscriptionId);

export const writeTaskFrameSseEvent = (frame: unknown): Uint8Array => {
  const cursor = (frame as { cursor: { epoch: string; sequence: number } }).cursor;
  return new TextEncoder().encode(
    [
      `id: ${cursor.epoch}:${cursor.sequence}`,
      "event: task-frame",
      `data: ${JSON.stringify(frame)}`,
      "",
      "",
    ].join("\n"),
  );
};

const createTaskEventSseResponse = (
  leaseManager: TaskEventLeaseManager,
  subscriptionId: string,
  corsHeaders: HeadersInit,
): Response => {
  let generation = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const lease = leaseManager.get(subscriptionId);
      if (!lease) {
        controller.error(new Error("Task event stream lease was released before connection."));
        return;
      }
      generation = leaseManager.attach(lease, controller);
    },
    cancel() {
      const lease = leaseManager.get(subscriptionId);
      if (lease) leaseManager.detach(lease, generation);
    },
  });
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
};

const parseTaskEventAckCursor = (
  body: Record<string, unknown>,
): Effect.Effect<ReturnType<typeof taskEventCursorSchema.parse>, WebHostRequestError> =>
  Effect.gen(function* () {
    if (Object.keys(body).length !== 1 || !("cursor" in body)) {
      return yield* reject("Task event stream acknowledgement body must contain only cursor.", 400);
    }
    const parsed = taskEventCursorSchema.safeParse(body.cursor);
    if (!parsed.success) {
      return yield* reject("Task event stream acknowledgement cursor is invalid.", 400);
    }
    return parsed.data;
  });

export const routeTaskEventHttpRequest = ({
  appToken,
  controlToken,
  corsHeaders,
  parseJsonObjectBody,
  request,
  requestTimeouts,
  shutdownStarted,
  taskEventLeaseManager,
  validateAppCookieOrHeader,
  validateAppSessionCookie,
}: TaskEventHttpServerContext): Effect.Effect<Response | null, WebHostRequestError> =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === TASK_EVENT_SUBSCRIPTIONS_PATH && request.method === "POST") {
      yield* validateAppCookieOrHeader(request, appToken);
      if (shutdownStarted) {
        return yield* reject(
          "Browser backend is shutting down and is no longer accepting new work.",
          503,
        );
      }
      if (!taskEventLeaseManager) {
        return yield* reject("Task event stream transport is unavailable.", 500);
      }
      const parsed = taskEventStreamSubscribeSchema.safeParse(yield* parseJsonObjectBody(request));
      if (!parsed.success) {
        return yield* reject("Task event stream subscription cursor is invalid.", 400);
      }
      const subscriptionId = crypto.randomUUID();
      yield* Effect.try({
        try: () => taskEventLeaseManager.create(parsed.data, subscriptionId),
        catch: (cause) =>
          new WebHostRequestError({
            cause,
            message: `Failed to create task event stream subscription: ${errorMessage(cause)}`,
            status: 500,
          }),
      });
      return jsonResponse(
        {
          streamToken: taskEventStreamCapability(controlToken, subscriptionId),
          subscriptionId,
        },
        { status: 201 },
        corsHeaders,
      );
    }

    const taskStreamMatch = /^\/task-events\/subscriptions\/([^/]+)(?:\/(stream|ack))?$/.exec(
      requestUrl.pathname,
    );
    if (!taskStreamMatch) {
      return null;
    }
    const [, subscriptionId, operation] = taskStreamMatch;
    if (operation === "stream") {
      yield* validateAppSessionCookie(request, appToken);
    } else {
      yield* validateAppCookieOrHeader(request, appToken);
    }
    const token =
      operation === "stream"
        ? requestUrl.searchParams.get("token")
        : request.headers.get(TASK_EVENT_STREAM_TOKEN_HEADER);
    const validCapability = subscriptionId
      ? isValidTaskEventStreamCapability(controlToken, subscriptionId, token)
      : false;
    if (!subscriptionId || !isPublicSubscriptionId(subscriptionId) || !validCapability) {
      return yield* reject("Task event stream capability is invalid.", 403);
    }
    if (!taskEventLeaseManager) {
      return yield* reject("Task event stream transport is unavailable.", 500);
    }

    if (operation === "stream" && request.method === "GET") {
      if (shutdownStarted) {
        return yield* reject(
          "Browser backend is shutting down and is no longer accepting new work.",
          503,
        );
      }
      const lease = taskEventLeaseManager.get(subscriptionId);
      if (!lease) {
        return yield* reject(
          "Task event stream subscription has expired; create a new subscription.",
          410,
        );
      }
      requestTimeouts?.timeout(request, 0);
      return createTaskEventSseResponse(taskEventLeaseManager, lease.subscriptionId, corsHeaders);
    }

    if (operation === "ack" && request.method === "POST") {
      const lease = taskEventLeaseManager.get(subscriptionId);
      if (!lease) {
        return yield* reject(
          "Task event stream subscription has expired; create a new subscription.",
          410,
        );
      }
      const cursor = yield* parseTaskEventAckCursor(yield* parseJsonObjectBody(request));
      yield* Effect.try({
        try: () => taskEventLeaseManager.acknowledge(lease, cursor),
        catch: (cause) =>
          new WebHostRequestError({
            cause,
            message: `Task event stream acknowledgement was rejected: ${errorMessage(cause)}`,
            status: 409,
          }),
      });
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!operation && request.method === "DELETE") {
      const lease = taskEventLeaseManager.get(subscriptionId);
      if (lease) taskEventLeaseManager.delete(lease);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    return null;
  });
