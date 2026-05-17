import { createServer, Socket } from "node:net";
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

export const canConnect = (port: number, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume, signal) => {
    const socket = new Socket();
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.off("connect", onConnect);
      socket.off("timeout", onTimeout);
      socket.off("error", onError);
      socket.destroy();
      resume(Effect.succeed(connected));
    };
    const abort = () => finish(false);
    const onConnect = () => finish(true);
    const onTimeout = () => finish(false);
    const onError = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    socket.setTimeout(timeoutMs);
    socket.once("connect", onConnect);
    socket.once("timeout", onTimeout);
    socket.once("error", onError);
    try {
      socket.connect(port, "127.0.0.1");
    } catch {
      finish(false);
    }
  });
