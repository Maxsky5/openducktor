import { Effect } from "effect";
import type { IncomingMessage } from "node:http";
import type { JSONType } from "zod";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { parseJson } from "../../effect/json";

const MAX_BODY_BYTES = 1024 * 1024;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message.trim() ? cause.message : String(cause);

export const readMcpBridgeRequestBody = (
  request: IncomingMessage,
): Effect.Effect<JSONType, HostOperationErrorAggregate> =>
  Effect.async<JSONType, HostOperationErrorAggregate>((resume, signal) => {
    let body = "";
    let receivedBytes = 0;
    let settled = false;
    const finish = (effect: Effect.Effect<JSONType, HostOperationErrorAggregate>): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      resume(effect);
    };
    const abort = (): void => {
      finish(
        Effect.fail(
          new HostOperationError({
            operation: "mcpHostBridge.readRequestBody",
            message: "MCP host bridge request body read was aborted.",
          }),
        ),
      );
      request.destroy();
    };
    const onData = (chunk: string): void => {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > MAX_BODY_BYTES) {
        finish(
          Effect.fail(
            new HostOperationError({
              operation: "mcpHostBridge.readRequestBody",
              message: "MCP host bridge request body exceeds 1 MiB.",
              details: { maxBodyBytes: MAX_BODY_BYTES },
            }),
          ),
        );
        request.destroy();
        return;
      }
      body += chunk;
    };
    const onEnd = (): void => {
      if (!body.trim()) {
        finish(Effect.succeed({}));
        return;
      }
      finish(
        Effect.try({
          try: () => parseJson(body),
          catch: (cause) =>
            new HostOperationError({
              operation: "mcpHostBridge.readRequestBody",
              message: `Invalid JSON request body: ${cause instanceof Error ? cause.message : cause}`,
              cause,
            }),
        }),
      );
    };
    const onError = (error: Error): void =>
      finish(
        Effect.fail(
          new HostOperationError({
            operation: "mcpHostBridge.readRequestBody",
            message: errorMessage(error),
            cause: error,
          }),
        ),
      );

    request.setEncoding("utf8");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
