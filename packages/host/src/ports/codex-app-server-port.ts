import { Context, type Effect } from "effect";
import type {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";
import type {
  CodexAppServerClientRequest,
  CodexAppServerProtocolMessage,
  CodexAppServerRequestId,
  CodexAppServerRequestMethod,
  CodexAppServerRequestResult,
  CodexAppServerRespondError,
  CodexAppServerRespondResult,
} from "./codex-app-server-protocol";

export type CodexAppServerError = HostOperationError | HostResourceError | HostValidationError;

export const CODEX_APP_SERVER_REQUEST_METHODS = [
  "initialize",
  "model/list",
  "thread/fork",
  "thread/list",
  "thread/loaded/list",
  "thread/read",
  "thread/resume",
  "thread/start",
  "thread/name/set",
  "thread/turns/list",
  "skills/list",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "gitDiffToRemote",
  "fuzzyFileSearch",
] as const satisfies readonly CodexAppServerRequestMethod[];

export type {
  CodexAppServerProtocolMessage,
  CodexAppServerRequestId,
  CodexAppServerRequestMethod,
  CodexAppServerRequestResult,
};

export type CodexAppServerRequestInput = { runtimeId: string } & CodexAppServerClientRequest;
export type CodexAppServerRespondInput = {
  runtimeId: string;
  requestId: CodexAppServerRequestId;
  result?: CodexAppServerRespondResult;
  error?: CodexAppServerRespondError;
};
export type CodexAppServerLoadedThreadListInput = {
  runtimeId: string;
  cursor: string | null;
  limit: number;
};
export type CodexAppServerLoadedThreadListResponse = {
  data: string[];
  nextCursor: string | null;
};
export type CodexSessionStatus = "active" | "idle" | "notLoaded" | "systemError";
export type CodexAppServerStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  receivedAt: string;
  message: CodexAppServerProtocolMessage;
};
export type CodexAppServerThreadEntry = {
  id: string;
  cwd: string;
  status: CodexSessionStatus;
};
export type CodexAppServerThreadListInput = {
  runtimeId: string;
  cursor: string | null;
  limit: number;
};
export type CodexAppServerThreadListResponse = {
  data: CodexAppServerThreadEntry[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};
export type CodexAppServerPort = {
  request(
    input: CodexAppServerRequestInput,
  ): Effect.Effect<CodexAppServerRequestResult, CodexAppServerError>;
  listLoadedThreads(
    input: CodexAppServerLoadedThreadListInput,
  ): Effect.Effect<CodexAppServerLoadedThreadListResponse, CodexAppServerError>;
  listThreads(
    input: CodexAppServerThreadListInput,
  ): Effect.Effect<CodexAppServerThreadListResponse, CodexAppServerError>;
  takeBufferedEvents(
    runtimeId: string,
  ): Effect.Effect<CodexAppServerStreamEvent[], CodexAppServerError>;
  respond(input: CodexAppServerRespondInput): Effect.Effect<void, CodexAppServerError>;
};

export class CodexAppServerPortTag extends Context.Tag("@openducktor/host/CodexAppServerPort")<
  CodexAppServerPortTag,
  CodexAppServerPort
>() {}
