import type { CodexAppServerThread, RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";

type CodexThreadReaderPort = Pick<CodexAppServerPort, "request">;

export const runtimeIdFromStdioRoute = (runtimeRoute: RuntimeRoute): string | null =>
  runtimeRoute.type === "stdio" ? runtimeRoute.identity : null;

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
    return (response as { thread: CodexAppServerThread }).thread;
  });
