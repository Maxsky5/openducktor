import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
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

type PendingResponseInput = {
  id: number;
  method: CodexAppServerRequestMethod;
  runtimeId: string;
  requestTimeoutMs: number;
  pending: Map<number, PendingCodexAppServerRequest>;
  rememberCancelledSentRequest(id: number): void;
};

export const acquirePendingResponse = ({
  id,
  method,
  runtimeId,
  requestTimeoutMs,
  pending,
  rememberCancelledSentRequest,
}: PendingResponseInput) =>
  Effect.sync(() => {
    let timeout: NodeJS.Timeout;
    let released = false;
    let finished = false;
    let writeStarted = false;
    let resumeEffect: ((effect: ResponseEffect) => void) | null = null;
    let settledEffect: ResponseEffect | null = null;

    const release = (options: { preserveLateResponse?: boolean } = {}): void => {
      if (released) {
        return;
      }
      released = true;
      clearTimeout(timeout);
      pending.delete(id);
      if (options.preserveLateResponse && writeStarted && !finished) {
        rememberCancelledSentRequest(id);
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

    timeout = setTimeout(() => {
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
      timeout,
      resolve: (value) => {
        resolveAfterQueuedMessages((resolvedValue) => finish(Effect.succeed(resolvedValue)), value);
      },
      reject: (error) => {
        finish(
          Effect.fail(
            toHostOperationError(error, `codexAppServerTransport.request.${method}`, {
              runtimeId,
              method,
            }),
          ),
        );
      },
    });

    const response = Effect.async<CodexAppServerRequestResult, CodexAppServerTransportError>(
      (resume) => {
        if (settledEffect) {
          resume(settledEffect);
          return;
        }
        resumeEffect = resume;
      },
    );

    return {
      markWriteStarted() {
        writeStarted = true;
      },
      release,
      response,
    };
  });
