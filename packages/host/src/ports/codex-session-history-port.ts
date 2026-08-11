import type { Effect } from "effect";
import type {
  CodexAppServerThreadTurnsListParams,
  CodexAppServerThreadTurnsListResponse,
} from "./codex-app-server-protocol";
import type { CodexSessionHistoryError } from "./codex-session-history-error";

export type CodexSessionHistoryPageInput = {
  runtimeId: string;
} & CodexAppServerThreadTurnsListParams;

export type CodexSessionHistoryPort = {
  listThreadTurns(
    input: CodexSessionHistoryPageInput,
  ): Effect.Effect<CodexAppServerThreadTurnsListResponse, CodexSessionHistoryError>;
};
