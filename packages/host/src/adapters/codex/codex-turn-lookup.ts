import type {
  CodexAppServerThreadTurnsListResponse,
  CodexAppServerTurn,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";

type CodexTurnReaderPort = Pick<CodexAppServerPort, "request">;

const isActiveCodexTurn = (turn: CodexAppServerTurn): boolean =>
  typeof turn.id === "string" &&
  turn.id.length > 0 &&
  turn.startedAt !== null &&
  turn.completedAt === null;

export const findActiveCodexTurnId = (
  codexAppServer: CodexTurnReaderPort,
  runtimeId: string,
  threadId: string,
): Effect.Effect<string | null, CodexAppServerError> =>
  Effect.gen(function* () {
    const response = (yield* codexAppServer.request({
      runtimeId,
      method: "thread/turns/list",
      params: {
        threadId,
        limit: 20,
        sortDirection: "desc",
        itemsView: "summary",
      },
    })) as CodexAppServerThreadTurnsListResponse;
    return response.data.find(isActiveCodexTurn)?.id ?? null;
  });
