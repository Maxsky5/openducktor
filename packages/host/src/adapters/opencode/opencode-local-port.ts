import { type IncomingMessage, request } from "node:http";
import { createServer } from "node:net";
import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostResourceError,
  type HostResourceErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";

const openCodeHealthSchema = z.object({ healthy: z.literal(true) }).passthrough();
const tcpAddressSchema = z.object({ port: z.number() }).passthrough();

type PickFreePortError = HostOperationErrorAggregate | HostResourceErrorAggregate;

export const pickFreePort = (): Effect.Effect<number, PickFreePortError> =>
  Effect.async<number, PickFreePortError>((resume, signal) => {
    const server = createServer();
    let settled = false;
    const finish = (effect: Effect.Effect<number, PickFreePortError>) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      server.off("error", onError);
      resume(effect);
    };
    const closeThenFinish = (effect: Effect.Effect<number, PickFreePortError>): void => {
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
        const address = tcpAddressSchema.safeParse(server.address());
        if (!address.success) {
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
        closeThenFinish(Effect.succeed(address.data.port));
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
            finish(openCodeHealthSchema.safeParse(parseJson(body)).success);
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
