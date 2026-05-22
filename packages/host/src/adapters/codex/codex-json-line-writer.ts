import type { Writable } from "node:stream";
import { Effect } from "effect";
import { type HostOperationError, toHostOperationError } from "../../effect/host-errors";

const WRITE_OPERATION = "codexAppServerTransport.writeLine";

export const writeJsonLine = (
  stdin: Writable,
  payload: unknown,
  options: { onWriteStarted?: () => void } = {},
): Effect.Effect<void, HostOperationError> =>
  Effect.async((resume) => {
    let active = true;
    let writeCallbackFinished = false;
    let writeCallbackFailed = false;
    stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      writeCallbackFinished = true;
      writeCallbackFailed = Boolean(error);
      if (!active) {
        return;
      }
      if (error) {
        resume(Effect.fail(toHostOperationError(error, WRITE_OPERATION)));
        return;
      }
      resume(Effect.void);
    });
    if (!writeCallbackFinished || !writeCallbackFailed) {
      options.onWriteStarted?.();
    }
    return Effect.sync(() => {
      active = false;
    });
  });
