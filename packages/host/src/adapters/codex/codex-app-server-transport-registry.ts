import { Effect, Layer } from "effect";
import {
  HostInvariantError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerPort,
  CodexAppServerProtocolMessage,
  CodexAppServerRequestInput,
  CodexAppServerRequestResult,
  CodexAppServerRespondInput,
  CodexAppServerThreadListResponse,
  CodexSessionStatus,
} from "../../ports/codex-app-server-port";
import { CodexAppServerPortTag } from "../../ports/codex-app-server-port";
import type { CodexAppServerClientRequest } from "../../ports/codex-app-server-protocol";
import type { CodexAppServerTransportError } from "./codex-app-server-transport-types";

export type CodexAppServerTransportRegistryError = CodexAppServerTransportError | HostResourceError;

export type CodexAppServerTransport = {
  request(
    input: CodexAppServerClientRequest,
  ): Effect.Effect<CodexAppServerRequestResult, CodexAppServerTransportError>;
  drainNotifications(): Effect.Effect<CodexAppServerProtocolMessage[], never>;
  drainServerRequests(): Effect.Effect<CodexAppServerProtocolMessage[], never>;
  respond(
    input: Omit<CodexAppServerRespondInput, "runtimeId">,
  ): Effect.Effect<void, CodexAppServerTransportError>;
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, context: string): Record<string, unknown> => {
  if (!isJsonRecord(value)) {
    throw new HostValidationError({
      message: `${context} must be an object`,
      details: { context },
    });
  }
  return value;
};

const requireString = (value: unknown, context: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostValidationError({
      message: `${context} must be a non-empty string`,
      details: { context },
    });
  }
  return value;
};

const parseCursor = (value: unknown, context: string): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return requireString(value, context);
};

const parseLoadedThreadListResponse = (value: unknown): CodexAppServerLoadedThreadListResponse => {
  const payload = requireRecord(value, "Codex thread/loaded/list response");
  if (!Array.isArray(payload.data)) {
    throw new HostValidationError({
      message: "Codex thread/loaded/list response data must be an array",
      details: { context: "Codex thread/loaded/list response" },
    });
  }
  return {
    data: payload.data.map((entry, index) => {
      return requireString(entry, `Codex loaded thread entry ${index}`);
    }),
    nextCursor: parseCursor(payload.nextCursor, "Codex thread/loaded/list nextCursor"),
  };
};

const parseThreadStatus = (value: unknown, context: string): CodexSessionStatus => {
  const record = requireRecord(value ?? null, `${context} status`);
  if (record.type === "idle" || record.type === "notLoaded" || record.type === "systemError") {
    return record.type;
  }
  if (record.type === "active") {
    if (!Array.isArray(record.activeFlags)) {
      throw new HostValidationError({
        message: `${context} active status activeFlags must be an array`,
        details: { context },
      });
    }
    return record.type;
  }
  throw new HostValidationError({
    message: `${context} has unsupported Codex thread status: ${String(record.type)}`,
    details: { context, statusType: record.type },
  });
};

const parseThreadListResponse = (value: unknown): CodexAppServerThreadListResponse => {
  const payload = requireRecord(value, "Codex thread/list response");
  if (!Array.isArray(payload.data)) {
    throw new HostValidationError({
      message: "Codex thread/list response data must be an array",
      details: { context: "Codex thread/list response" },
    });
  }
  return {
    data: payload.data.map((entry, index) => {
      const record = requireRecord(entry, `Codex thread entry ${index}`);
      return {
        id: requireString(record.id, `Codex thread entry ${index} id`),
        cwd: requireString(record.cwd, `Codex thread entry ${index} cwd`),
        status: parseThreadStatus(record.status, `Codex thread entry ${index}`),
      };
    }),
    nextCursor: parseCursor(payload.nextCursor, "Codex thread/list nextCursor"),
    backwardsCursor: parseCursor(payload.backwardsCursor, "Codex thread/list backwardsCursor"),
  };
};

export type CodexAppServerTransportRegistry = CodexAppServerPort & {
  registerTransport(runtimeId: string, transport: CodexAppServerTransport): void;
  unregisterTransport(runtimeId: string): void;
};
export const createCodexAppServerTransportRegistry = (): CodexAppServerTransportRegistry => {
  const transports = new Map<string, CodexAppServerTransport>();
  const requireTransport = (runtimeId: string) =>
    Effect.gen(function* () {
      const transport = transports.get(runtimeId);
      if (!transport) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "codexAppServerTransport",
            operation: "codexAppServer.requireTransport",
            message: `Codex app-server transport not found for runtime ${runtimeId}`,
            details: { runtimeId },
          }),
        );
      }
      return transport;
    });
  const requestJson = ({
    runtimeId,
    method,
    params,
  }: CodexAppServerRequestInput): Effect.Effect<
    CodexAppServerRequestResult,
    CodexAppServerTransportRegistryError
  > =>
    Effect.gen(function* () {
      const transport = yield* requireTransport(runtimeId);
      return yield* transport.request({
        method,
        ...(params !== undefined ? { params } : {}),
      });
    });

  return {
    registerTransport(runtimeId, transport) {
      if (transports.has(runtimeId)) {
        throw new HostInvariantError({
          invariant: "codex_app_server_transport_unique",
          message: `Codex app-server transport already registered for runtime ${runtimeId}`,
          details: { runtimeId },
        });
      }
      transports.set(runtimeId, transport);
    },
    unregisterTransport(runtimeId) {
      transports.delete(runtimeId);
    },
    request({ runtimeId, method, params }) {
      return requestJson({ runtimeId, method, ...(params !== undefined ? { params } : {}) });
    },
    listLoadedThreads({ runtimeId, cursor, limit }) {
      return Effect.gen(function* () {
        const payload = yield* requestJson({
          runtimeId,
          method: "thread/loaded/list",
          params: { cursor, limit },
        });
        return yield* Effect.try({
          try: () => parseLoadedThreadListResponse(payload),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
              details: { method: "thread/loaded/list", runtimeId },
            }),
        });
      });
    },
    listThreads({ runtimeId, cursor, limit }) {
      return Effect.gen(function* () {
        const payload = yield* requestJson({
          runtimeId,
          method: "thread/list",
          params: { cursor, limit },
        });
        return yield* Effect.try({
          try: () => parseThreadListResponse(payload),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
              details: { method: "thread/list", runtimeId },
            }),
        });
      });
    },
    drainNotifications(runtimeId) {
      return Effect.gen(function* () {
        const transport = yield* requireTransport(runtimeId);
        return yield* transport.drainNotifications();
      });
    },
    drainServerRequests(runtimeId) {
      return Effect.gen(function* () {
        const transport = yield* requireTransport(runtimeId);
        return yield* transport.drainServerRequests();
      });
    },
    respond({ runtimeId, requestId, result, error }) {
      return Effect.gen(function* () {
        const transport = yield* requireTransport(runtimeId);
        yield* transport.respond({
          requestId,
          ...(result !== undefined ? { result } : {}),
          ...(error !== undefined ? { error } : {}),
        });
      });
    },
  };
};

export const CodexAppServerPortLive = Layer.sync(
  CodexAppServerPortTag,
  createCodexAppServerTransportRegistry,
);
