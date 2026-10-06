import { Effect } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  CodexAppServerRequestMethod,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import { resolveAfterQueuedMessages } from "./codex-app-server-transport-messages";
import type {
  CodexAppServerTransportError,
  PendingCodexAppServerRequest,
} from "./codex-app-server-transport-types";

type ResponseEffect = Effect.Effect<CodexAppServerRequestResult, CodexAppServerTransportError>;
type ScheduleTimeout = (callback: () => void, timeoutMs: number) => () => void;

type PendingResponse = {
  markWriteStarted(): void;
  release(options?: { keepRequestId?: boolean }): void;
  response: ResponseEffect;
};

type PendingResponseInput = {
  id: number;
  method: CodexAppServerRequestMethod;
  runtimeId: string;
  requestTimeoutMs: number;
  pending: Map<number, PendingCodexAppServerRequest>;
  keepLateRequestId(id: number): void;
  scheduleTimeout?: ScheduleTimeout;
};

export const acquirePendingResponse = ({
  id,
  method,
  runtimeId,
  requestTimeoutMs,
  pending,
  keepLateRequestId,
  scheduleTimeout: scheduleRequestTimeout = scheduleTimeout,
}: PendingResponseInput): Effect.Effect<PendingResponse> =>
  Effect.sync(() => {
    let cancelTimeout: (() => void) | undefined;
    let released = false;
    let finished = false;
    let writeStarted = false;
    let resumeEffect: ((effect: ResponseEffect) => void) | null = null;
    let settledEffect: ResponseEffect | null = null;

    const release: PendingResponse["release"] = (options = {}) => {
      if (released) {
        return;
      }
      released = true;
      cancelTimeout?.();
      pending.delete(id);
      if (options.keepRequestId && writeStarted && !finished) {
        keepLateRequestId(id);
      }
    };

    const finish = (effect: ResponseEffect): void => {
      if (finished) {
        return;
      }
      finished = true;
      release();
      if (resumeEffect) {
        resumeEffect(effect);
        return;
      }
      settledEffect = effect;
    };

    cancelTimeout = scheduleRequestTimeout(() => {
      release({ keepRequestId: true });
      finish(
        Effect.fail(
          new HostOperationError({
            operation: `codexAppServerTransport.request.${method}`,
            message: `Timed out waiting for Codex app-server request ${method} on runtime ${runtimeId} after ${requestTimeoutMs}ms`,
            details: { runtimeId, method, requestTimeoutMs },
          }),
        ),
      );
    }, requestTimeoutMs);

    pending.set(id, {
      method,
      resolve: (value) => {
        release();
        resolveAfterQueuedMessages((resolvedValue) => finish(Effect.succeed(resolvedValue)), value);
      },
      reject: (error) => {
        finish(
          Effect.fail(
            error instanceof HostValidationError
              ? error
              : toHostOperationError(error, `codexAppServerTransport.request.${method}`, {
                  runtimeId,
                  method,
                }),
          ),
        );
      },
    });

    const response = Effect.callback<CodexAppServerRequestResult, CodexAppServerTransportError>(
      (resume) => {
        if (settledEffect) {
          resume(settledEffect);
          return;
        }
        resumeEffect = resume;
      },
    );

    return {
      markWriteStarted(): void {
        writeStarted = true;
      },
      release,
      response,
    };
  });

const scheduleTimeout: ScheduleTimeout = (callback, timeoutMs) => {
  const timeout = setTimeout(callback, timeoutMs);
  return () => clearTimeout(timeout);
};
