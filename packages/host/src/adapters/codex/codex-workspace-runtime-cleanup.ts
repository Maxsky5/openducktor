import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import {
  type ProcessTreeTerminator,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { CodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";

export type CodexChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

type CodexRuntimeTransport = {
  readonly rejectPendingRequestsForShutdown: () => Effect.Effect<void, HostOperationError>;
  readonly close: () => Effect.Effect<void, HostOperationError>;
};

export const cleanupCodexRuntime = ({
  child,
  closed,
  codexAppServer,
  nextRuntimeId,
  pid,
  processTreeTerminator,
  stopTimeoutMs,
  transport,
}: {
  child: CodexChildProcess;
  closed: () => boolean;
  codexAppServer: CodexAppServerTransportRegistry;
  nextRuntimeId: string;
  pid: number;
  processTreeTerminator: ProcessTreeTerminator;
  stopTimeoutMs: number;
  transport: CodexRuntimeTransport;
}) =>
  Effect.gen(function* () {
    const errors: string[] = [];
    codexAppServer.unregisterTransport(nextRuntimeId);

    const pendingRequestExit = yield* Effect.exit(transport.rejectPendingRequestsForShutdown());
    if (pendingRequestExit._tag === "Failure") {
      errors.push(`pending requests: ${pendingRequestExit.cause}`);
    }

    const processExit = yield* Effect.either(
      processTreeTerminator({
        pid,
        label: `Codex app-server runtime ${nextRuntimeId}`,
        isClosed: closed,
        waitForExit: (timeoutMs) => waitForChildProcessClose(child, closed, timeoutMs),
        stopTimeoutMs,
      }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.stopProcess"),
        ),
      ),
    );
    if (processExit._tag === "Left") {
      errors.push(`process tree: ${processExit.left.message}`);
    }

    const transportExit = yield* Effect.exit(transport.close());
    if (transportExit._tag === "Failure") {
      errors.push(`transport: ${transportExit.cause}`);
    }

    if (errors.length > 0) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexWorkspaceRuntime.cleanup",
          message: errors.join("\n"),
          details: { runtimeId: nextRuntimeId },
        }),
      );
    }
  });
