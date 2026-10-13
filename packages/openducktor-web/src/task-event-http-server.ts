import { createHmac, timingSafeEqual } from "node:crypto";
import { taskEventCursorSchema, taskEventStreamSubscribeSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { errorMessage, WebHostRequestError } from "@openducktor/remote-host/effect/web-errors";
import type { TaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";
import type { NodeFetchServer } from "@openducktor/remote-host/node-fetch-server";
import { createTaskEventSseResponse } from "@openducktor/remote-host/task-event-sse";

export type WebRequestBody = Record<string, JSONType>;

export const TASK_EVENT_STREAM_TOKEN_HEADER = "x-openducktor-task-stream-token";
const TASK_EVENT_SUBSCRIPTIONS_PATH = "/task-events/subscriptions";

type RequestTimeoutController = Pick<NodeFetchServer<unknown>, "timeout">;

type RequestContext = {
  appToken: string;
  controlToken: string;
  corsHeaders: HeadersInit;
  parseJsonObjectBody: (request: Request) => Effect.Effect<WebRequestBody, WebHostRequestError>;
  request: Request;
  requestTimeouts?: RequestTimeoutController | undefined;
  requestTimeoutSource?: Request | undefined;
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

type SubscriptionResponse = {
  streamToken: string;
  subscriptionId: string;
};

export const routeTaskEventHttpRequest = ({
  appToken,
  controlToken,
  corsHeaders,
  parseJsonObjectBody,
  request,
  requestTimeouts,
  requestTimeoutSource,
  shutdownStarted,
  taskEventLeaseManager,
  validateAppCookieOrHeader,
  validateAppSessionCookie,
}: RequestContext): Effect.Effect<Response | null, WebHostRequestError> =>
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
          streamToken: streamToken(controlToken, subscriptionId),
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
    const validToken = subscriptionId
      ? acceptsStreamToken(controlToken, subscriptionId, token)
      : false;
    if (!subscriptionId || !isSubscriptionId(subscriptionId) || !validToken) {
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
      requestTimeouts?.timeout(requestTimeoutSource ?? request, 0);
      return createTaskEventSseResponse(
        taskEventLeaseManager,
        lease.subscriptionId,
        corsHeaders,
        request.signal,
      );
    }

    if (operation === "ack" && request.method === "POST") {
      const lease = taskEventLeaseManager.get(subscriptionId);
      if (!lease) {
        return yield* reject(
          "Task event stream subscription has expired; create a new subscription.",
          410,
        );
      }
      const cursor = yield* parseAckCursor(yield* parseJsonObjectBody(request));
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

const reject = (message: string, status: number): Effect.Effect<never, WebHostRequestError> =>
  Effect.fail(new WebHostRequestError({ message, status }));

const jsonResponse = (
  payload: SubscriptionResponse,
  init: ResponseInit,
  corsHeaders: HeadersInit,
): Response =>
  new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...init.headers,
    },
  });

const streamToken = (controlToken: string, subscriptionId: string): string =>
  createHmac("sha256", controlToken)
    .update(`task-event-stream:v1:${subscriptionId}`)
    .digest("base64url");

const acceptsStreamToken = (
  controlToken: string,
  subscriptionId: string,
  receivedToken: string | null,
): boolean => {
  if (!receivedToken) return false;
  const expected = Buffer.from(streamToken(controlToken, subscriptionId));
  const received = Buffer.from(receivedToken);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
};

const isSubscriptionId = (subscriptionId: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subscriptionId);

const parseAckCursor = (
  body: WebRequestBody,
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
