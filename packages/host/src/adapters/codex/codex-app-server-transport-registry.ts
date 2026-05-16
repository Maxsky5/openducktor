import { Effect } from "effect";
import { HostInvariantError, HostResourceError } from "../../effect/host-errors";
import type {
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";
import type { CodexAppServerTransportError } from "./codex-app-server-transport";

export type CodexAppServerTransportRegistryError = CodexAppServerTransportError | HostResourceError;

export type CodexAppServerTransport = {
  request(
    input: Omit<CodexAppServerRequestInput, "runtimeId">,
  ): Effect.Effect<unknown, CodexAppServerTransportError>;
  drainNotifications(): Effect.Effect<unknown[], never>;
  drainServerRequests(): Effect.Effect<unknown[], never>;
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
      return Effect.gen(function* () {
        const transport = yield* requireTransport(runtimeId);
        return yield* transport.request({
          method,
          ...(params !== undefined ? { params } : {}),
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
