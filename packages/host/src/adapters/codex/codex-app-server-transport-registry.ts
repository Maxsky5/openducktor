import { randomUUID } from "node:crypto";
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
} from "../../ports/codex-app-server-port";
import type { CodexAppServerClientRequest } from "../../ports/codex-app-server-protocol";
import { jsonValueSchema, parseCodexAppServerClientRequest } from "@openducktor/contracts";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import type { CodexSessionHistoryPort } from "../../ports/codex-session-history-port";
import {
  parseLoadedThreadListResponse,
  parseThreadListResponse,
  parseThreadTurnsListResponse,
} from "./codex-app-server-response-parsers";
import type { CodexAppServerTransportError } from "./codex-app-server-transport-types";

export type CodexAppServerTransportRegistryError = CodexAppServerTransportError | HostResourceError;

export type CodexAppServerTransport = {
  request(
    input: CodexAppServerClientRequest,
  ): Effect.Effect<CodexAppServerRequestResult, CodexAppServerTransportError>;
  respond(
    input: Omit<CodexAppServerRespondInput, "runtimeId">,
  ): Effect.Effect<void, CodexAppServerTransportError>;
};

export type CodexAppServerTransportRegistry = CodexAppServerPort &
  CodexSessionHistoryPort & {
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
  const requestJson = (
    input: CodexAppServerRequestInput,
  ): Effect.Effect<CodexAppServerRequestResult, CodexAppServerTransportRegistryError> =>
    Effect.gen(function* () {
      const transport = yield* requireTransport(input.runtimeId);
      const request = parseCodexAppServerClientRequest(
        jsonValueSchema.parse({ method: input.method, params: input.params }),
      );
      return yield* transport.request(request);
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
    request(input) {
      return requestJson(input);
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
    listThreadTurns({ runtimeId, threadId, cursor, limit, sortDirection, itemsView }) {
      const method = "thread/turns/list";
      const toFailure = (
        code: "invalid_runtime_response" | "request_failed",
        cause: unknown,
      ): CodexSessionHistoryError => {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return new CodexSessionHistoryError({
          message: detail,
          runtimeId,
          threadId,
          cause,
          failure: {
            code,
            summary:
              code === "invalid_runtime_response"
                ? "Codex returned invalid conversation history."
                : "Codex conversation history could not be loaded.",
            detail,
            diagnosticId: randomUUID(),
            method,
            pageCursor: cursor ?? null,
          },
        });
      };

      return requestJson({
        runtimeId,
        method,
        params: { threadId, cursor, limit, sortDirection, itemsView },
      }).pipe(
        Effect.mapError((cause) => toFailure("request_failed", cause)),
        Effect.flatMap((payload) =>
          Effect.try({
            try: () => parseThreadTurnsListResponse(payload),
            catch: (cause) => toFailure("invalid_runtime_response", cause),
          }),
        ),
      );
    },
    respond({ runtimeId, requestId, result, error }) {
      return Effect.gen(function* () {
        const transport = yield* requireTransport(runtimeId);
        yield* transport.respond({
          requestId,
          ...(result !== undefined ? { result } : undefined),
          ...(error !== undefined ? { error } : undefined),
        });
      });
    },
  };
};
