import { type IncomingMessage, request } from "node:http";
import { createServer } from "node:net";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  toHostOperationError,
} from "../../effect/host-errors";

export const pickFreePort = (): Effect.Effect<number, HostOperationError | HostResourceError> =>
  Effect.async<number, HostOperationError | HostResourceError>((resume, signal) => {
    const server = createServer();
    let settled = false;
    const finish = (effect: Effect.Effect<number, HostOperationError | HostResourceError>) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      server.off("error", onError);
      resume(effect);
    };
    const closeThenFinish = (
      effect: Effect.Effect<number, HostOperationError | HostResourceError>,
    ): void => {
      if (!server.listening) {
        finish(effect);
        return;
      }
      server.close((error) => {
        if (error) {
          finish(Effect.fail(toHostOperationError(error, "opencode.pickFreePort.close")));
          return;
        }
        finish(effect);
      });
    };
    const abort = () =>
      closeThenFinish(
        Effect.fail(
          new HostOperationError({
            operation: "opencode.pickFreePort",
            message: "Local port allocation was aborted.",
          }),
        ),
      );
    const onError = (error: Error) =>
      finish(Effect.fail(toHostOperationError(error, "opencode.pickFreePort")));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    server.once("error", onError);
    try {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          closeThenFinish(
            Effect.fail(
              new HostResourceError({
                resource: "localPort",
                operation: "opencode.pickFreePort",
                message: "Failed to allocate a local OpenCode runtime port.",
              }),
            ),
          );
          return;
        }
        closeThenFinish(Effect.succeed(address.port));
      });
    } catch (error) {
      finish(Effect.fail(toHostOperationError(error, "opencode.pickFreePort")));
    }
  });

export const isOpenCodeHealthy = (port: number, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume, signal) => {
    let settled = false;
    let response: IncomingMessage | null = null;
    const finish = (healthy: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      response?.destroy();
      probe.destroy();
      resume(Effect.succeed(healthy));
    };
    const abort = () => finish(false);
    const probe = request(
      {
        host: "127.0.0.1",
        port,
        path: "/global/health",
        method: "GET",
      },
      (nextResponse) => {
        response = nextResponse;
        if (nextResponse.statusCode !== 200) {
          finish(false);
          return;
        }
        let body = "";
        nextResponse.setEncoding("utf8");
        nextResponse.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 4_096) {
            finish(false);
          }
        });
        nextResponse.once("end", () => {
          try {
            const parsed: unknown = JSON.parse(body);
            finish(
              typeof parsed === "object" &&
                parsed !== null &&
                "healthy" in parsed &&
                parsed.healthy === true,
            );
          } catch {
            finish(false);
          }
        });
      },
    );
    probe.setTimeout(timeoutMs, () => finish(false));
    probe.once("error", () => finish(false));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    probe.end();
  });
