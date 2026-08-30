import type { Writable } from "node:stream";
import type {
  CodexAppServerClientNotification,
  CodexAppServerRequestId,
  CodexAppServerRespondError,
  CodexAppServerRespondResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostOperationErrorAggregate, toHostOperationError } from "../../effect/host-errors";

const WRITE_OPERATION = "codexAppServerTransport.writeLine";

export type CodexTransportResponseMessage = {
  jsonrpc: "2.0";
  id: CodexAppServerRequestId;
  result?: CodexAppServerRespondResult;
  error?: CodexAppServerRespondError;
};

export type CodexTransportNotifyMessage = {
  jsonrpc: "2.0";
} & CodexAppServerClientNotification;

export const writeJsonLine = (
  stdin: Writable,
  payload: CodexTransportResponseMessage | CodexTransportNotifyMessage,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.async((resume) => {
    let active = true;
    stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (!active) {
        return;
      }
      if (error) {
        resume(Effect.fail(toHostOperationError(error, WRITE_OPERATION)));
        return;
      }
      resume(Effect.void);
    });
    return Effect.sync(() => {
      active = false;
    });
  });
