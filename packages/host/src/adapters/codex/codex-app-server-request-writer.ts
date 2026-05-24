import type { Writable } from "node:stream";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";

const createWriteError = (runtimeId: string, cause: unknown) =>
  new HostOperationError({
    operation: "codexAppServerTransport.sendMessage",
    message: `Failed writing Codex app-server message for runtime ${runtimeId}`,
    cause,
    details: { runtimeId },
  });

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
  Effect.gen(function* () {
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(payload)}\n`,
      catch: (cause) => createWriteError(runtimeId, cause),
    });

    yield* Effect.async<void, HostOperationError>((resume) => {
      let active = true;
      let writeReturned = false;
      let writeFailedSynchronously = false;

      try {
        stdin.write(line, (error) => {
          if (!writeReturned && error) {
            writeFailedSynchronously = true;
          }
          if (!active) {
            return;
          }
          if (error) {
            resume(Effect.fail(createWriteError(runtimeId, error)));
            return;
          }
          resume(Effect.void);
        });
      } catch (error) {
        writeFailedSynchronously = true;
        if (active) {
          resume(Effect.fail(createWriteError(runtimeId, error)));
        }
      }

      writeReturned = true;
      if (!writeFailedSynchronously) {
        markWriteStarted();
      }

      return Effect.sync(() => {
        active = false;
      });
    });
  });
