import type { CodexAppServerTurn } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import { isJsonRecord, parseThreadTurnsListResponse } from "./codex-app-server-response-parsers";

type CodexTurnReaderPort = Pick<CodexAppServerPort, "request">;

const isActiveCodexTurn = (turn: CodexAppServerTurn): boolean =>
  isJsonRecord(turn) &&
  typeof turn.id === "string" &&
  turn.id.length > 0 &&
  turn.startedAt !== null &&
  turn.completedAt === null;

const parseCodexTurnCandidates = (
  value: unknown,
  runtimeId: string,
  threadId: string,
): Effect.Effect<CodexAppServerTurn[], HostValidationError> =>
  Effect.try({
    try: () => parseThreadTurnsListResponse(value).data,
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { method: "thread/turns/list", runtimeId, threadId },
      }),
  });

export const findActiveCodexTurnId = (
  codexAppServer: CodexTurnReaderPort,
  runtimeId: string,
  threadId: string,
): Effect.Effect<string | null, CodexAppServerError> =>
  Effect.gen(function* () {
    const response = yield* codexAppServer.request({
      runtimeId,
      method: "thread/turns/list",
      params: {
        threadId,
        limit: 20,
        sortDirection: "desc",
        itemsView: "summary",
      },
    });
    const turns = yield* parseCodexTurnCandidates(response, runtimeId, threadId);
    return turns.find(isActiveCodexTurn)?.id ?? null;
  });
