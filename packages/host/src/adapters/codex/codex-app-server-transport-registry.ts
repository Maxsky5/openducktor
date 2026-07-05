import { Effect } from "effect";
import {
  HostInvariantError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRequestResult,
  CodexAppServerRespondInput,
  CodexAppServerStreamEvent,
} from "../../ports/codex-app-server-port";
import type { CodexAppServerClientRequest } from "../../ports/codex-app-server-protocol";
import {
  parseLoadedThreadListResponse,
  parseThreadListResponse,
} from "./codex-app-server-response-parsers";
import type { CodexAppServerTransportError } from "./codex-app-server-transport-types";

export type CodexAppServerTransportRegistryError = CodexAppServerTransportError | HostResourceError;

export type CodexAppServerTransport = {
  request(
    input: CodexAppServerClientRequest,
  ): Effect.Effect<CodexAppServerRequestResult, CodexAppServerTransportError>;
  takeBufferedEvents(): Effect.Effect<CodexAppServerStreamEvent[], never>;
  respond(
    input: Omit<CodexAppServerRespondInput, "runtimeId">,
  ): Effect.Effect<void, CodexAppServerTransportError>;
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
    takeBufferedEvents(runtimeId) {
      return Effect.gen(function* () {
        const transport = yield* requireTransport(runtimeId);
        return yield* transport.takeBufferedEvents();
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
