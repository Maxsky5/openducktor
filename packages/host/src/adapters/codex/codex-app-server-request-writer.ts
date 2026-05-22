import type { Writable } from "node:stream";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";

const WRITE_OPERATION = "codexAppServerTransport.writeLine";

type WriteCodexAppServerRequestInput = {
  stdin: Writable;
  payload: Record<string, unknown>;
  runtimeId: string;
  markWriteStarted(): void;
};

export const writeCodexAppServerRequestLine = ({
  stdin,
  payload,
  runtimeId,
  markWriteStarted,
}: WriteCodexAppServerRequestInput): Effect.Effect<void, HostOperationError> =>
  Effect.async<void, HostOperationError>((resume) => {
    let active = true;
    let writeReturned = false;
    let writeFailedSynchronously = false;

    stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (!writeReturned && error) {
        writeFailedSynchronously = true;
      }
      if (!active) {
        return;
      }
      if (error) {
        resume(Effect.fail(toHostOperationError(error, WRITE_OPERATION)));
        return;
      }
      resume(Effect.void);
    });

    writeReturned = true;
    if (!writeFailedSynchronously) {
      markWriteStarted();
    }

    return Effect.sync(() => {
      active = false;
    });
  }).pipe(
    Effect.mapError(
      (error) =>
        new HostOperationError({
          operation: "codexAppServerTransport.sendMessage",
          message: `Failed writing Codex app-server message for runtime ${runtimeId}`,
          cause: error,
          details: { runtimeId },
        }),
    ),
  );
