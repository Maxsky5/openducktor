import {
  parseCodexAppServerRequestResult,
  type CodexAppServerThread,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";

type CodexThreadReaderPort = Pick<CodexAppServerPort, "request">;
type CodexThreadParseErrorDetails = {
  method: "thread/read";
  runtimeId: string;
  threadId: string;
};

const parseCodexThread = (
  value: Parameters<typeof parseCodexAppServerRequestResult>[1],
  runtimeId: string,
  threadId: string,
): Effect.Effect<CodexAppServerThread, HostValidationError<CodexThreadParseErrorDetails>> =>
  Effect.try({
    try: () => parseCodexAppServerRequestResult("thread/read", value).thread,
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { method: "thread/read", runtimeId, threadId },
      }),
  });

export const readCodexThread = (
  codexAppServer: CodexThreadReaderPort,
  runtimeId: string,
  threadId: string,
): Effect.Effect<CodexAppServerThread, CodexAppServerError> =>
  Effect.gen(function* () {
    const response = yield* codexAppServer.request({
      runtimeId,
      method: "thread/read",
      params: { threadId, includeTurns: false },
    });
    const thread = yield* parseCodexThread(response, runtimeId, threadId);
    if (thread.id !== threadId) {
      return yield* new HostValidationError({
        field: "threadId",
        message: "Codex returned a different thread. Select the matching session and retry.",
        details: { method: "thread/read", runtimeId, threadId, returnedThreadId: thread.id },
      });
    }
    return thread;
  });
