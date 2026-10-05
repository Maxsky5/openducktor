import type { RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import { z, type JSONType } from "zod";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { RuntimeRegistryError } from "../../ports/runtime-registry-port";

const SESSION_REQUEST_TIMEOUT_MS = 2000;
const MAX_ABORT_ERROR_BODY_BYTES = 64 * 1024;
type RuntimeProbeObject = Record<string, JSONType>;
const runtimeProbeObjectSchema = z.record(z.string(), z.json());
const isRuntimeProbeObject = (value: JSONType | undefined): value is RuntimeProbeObject =>
  runtimeProbeObjectSchema.safeParse(value).success;

type RuntimeSessionRouteInput = {
  runtimeKind: string;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};

const requireOpenCodeLocalHttpEndpoint = (runtimeRoute: RuntimeRoute, operation: string) =>
  Effect.gen(function* () {
    if (runtimeRoute.type !== "local_http") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `OpenCode ${operation} requires a local_http runtime route.`,
          field: "runtimeRoute.type",
          details: { operation, routeType: runtimeRoute.type },
        }),
      );
    }
    const endpoint = yield* Effect.try({
      try: () => new URL(runtimeRoute.endpoint),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: { operation, endpoint: runtimeRoute.endpoint },
        }),
    });
    const host = endpoint.hostname.toLowerCase();
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!isLoopback) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `OpenCode ${operation} requires a loopback runtime endpoint.`,
          field: "runtimeRoute.endpoint",
          details: { operation, endpoint: runtimeRoute.endpoint },
        }),
      );
    }
    return endpoint;
  });

const sessionEndpoint = (endpoint: URL, routePath: string, workingDirectory: string): URL => {
  const url = new URL(routePath, endpoint);
  url.searchParams.set("directory", workingDirectory);
  return url;
};

const isLiveSessionStatus = (value: JSONType | undefined): boolean => {
  if (!isRuntimeProbeObject(value)) return false;
  const status = value.type;
  return status === "busy" || status === "retry";
};

const readBoundedResponseText = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => toHostOperationError(cause, "runtimeRegistry.readResponseText"),
  }).pipe(
    Effect.map((text) =>
      text.length > MAX_ABORT_ERROR_BODY_BYTES ? text.slice(0, MAX_ABORT_ERROR_BODY_BYTES) : text,
    ),
  );

export const stopOpenCodeSession = ({
  runtimeRoute,
  externalSessionId,
  workingDirectory,
}: RuntimeSessionRouteInput) =>
  Effect.gen(function* () {
    const endpoint = yield* requireOpenCodeLocalHttpEndpoint(runtimeRoute, "session abort");
    const url = sessionEndpoint(
      endpoint,
      `/session/${encodeURIComponent(externalSessionId)}/abort`,
      workingDirectory,
    );
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        }),
      catch: (cause) =>
        toHostOperationError(cause, "runtimeRegistry.stopOpenCodeSession", {
          externalSessionId,
          workingDirectory,
          url: url.toString(),
        }),
    });
    if (response.ok) {
      return;
    }
    const detail = (yield* readBoundedResponseText(response)).trim();
    if (!detail) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "runtimeRegistry.stopOpenCodeSession",
          message: `OpenCode runtime rejected abort for session ${externalSessionId} with status ${response.status}`,
          details: { externalSessionId, status: response.status },
        }),
      );
    }
    return yield* Effect.fail(
      new HostOperationError({
        operation: "runtimeRegistry.stopOpenCodeSession",
        message: `OpenCode runtime rejected abort for session ${externalSessionId} with status ${response.status}: ${detail}`,
        details: { externalSessionId, status: response.status, detail },
      }),
    );
  });

export const probeOpenCodeSessionStatus = ({
  runtimeRoute,
  externalSessionId,
  workingDirectory,
}: RuntimeSessionRouteInput): Effect.Effect<
  {
    supported: boolean;
    hasLiveSession: boolean;
  },
  RuntimeRegistryError
> =>
  Effect.gen(function* () {
    if (runtimeRoute.type !== "local_http") {
      return { supported: false, hasLiveSession: false };
    }
    const endpoint = yield* requireOpenCodeLocalHttpEndpoint(runtimeRoute, "session status probe");
    const url = sessionEndpoint(endpoint, "/session/status", workingDirectory);
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        }),
      catch: (cause) =>
        toHostOperationError(cause, "runtimeRegistry.probeOpenCodeSessionStatus", {
          workingDirectory,
          url: url.toString(),
        }),
    });
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => toHostOperationError(cause, "runtimeRegistry.readSessionStatusResponse"),
    });
    if (!response.ok) {
      const detail = body.trim();
      return yield* Effect.fail(
        new HostOperationError({
          operation: "runtimeRegistry.probeOpenCodeSessionStatus",
          message: detail
            ? `OpenCode session status probe failed with status ${response.status}: ${detail}`
            : `OpenCode session status probe failed with status ${response.status}`,
          details: { status: response.status, detail },
        }),
      );
    }
    const statuses = yield* Effect.try({
      try: () => parseJson(body),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: { operation: "runtimeRegistry.parseSessionStatusResponse" },
        }),
    });
    if (!isRuntimeProbeObject(statuses)) {
      return yield* Effect.fail(
        new HostValidationError({
          message: "OpenCode session status response must be an object",
          details: { operation: "runtimeRegistry.parseSessionStatusResponse" },
        }),
      );
    }
    return {
      supported: true,
      hasLiveSession: isLiveSessionStatus(statuses[externalSessionId]),
    };
  });
