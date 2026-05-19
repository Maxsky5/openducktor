import { Context, type Effect } from "effect";
import type {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";
import type {
  CodexAppServerClientRequest,
  CodexAppServerProtocolMessage,
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
  "thread/turns/list",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "gitDiffToRemote",
] as const;

export type {
  CodexAppServerProtocolMessage,
  CodexAppServerRequestMethod,
  CodexAppServerRequestResult,
};

export type CodexAppServerRequestInput = { runtimeId: string } & CodexAppServerClientRequest;
export type CodexAppServerRespondInput = {
  runtimeId: string;
  requestId: number;
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
  drainNotifications(
    runtimeId: string,
  ): Effect.Effect<CodexAppServerProtocolMessage[], CodexAppServerError>;
  drainServerRequests(
    runtimeId: string,
  ): Effect.Effect<CodexAppServerProtocolMessage[], CodexAppServerError>;
  respond(input: CodexAppServerRespondInput): Effect.Effect<void, CodexAppServerError>;
};

export class CodexAppServerPortTag extends Context.Tag("@openducktor/host/CodexAppServerPort")<
  CodexAppServerPortTag,
  CodexAppServerPort
>() {}
