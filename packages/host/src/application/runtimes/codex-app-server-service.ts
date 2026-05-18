import type { Effect } from "effect";
import type {
  CodexAppServerError,
  CodexAppServerLoadedThreadListInput,
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerPort,
  CodexAppServerProtocolMessage,
  CodexAppServerRequestInput,
  CodexAppServerRequestResult,
  CodexAppServerRespondInput,
  CodexAppServerThreadListInput,
  CodexAppServerThreadListResponse,
} from "../../ports/codex-app-server-port";

export type CodexAppServerServiceError = CodexAppServerError;

export type CodexAppServerService = {
  request(
    input: CodexAppServerRequestInput,
  ): Effect.Effect<CodexAppServerRequestResult, CodexAppServerServiceError>;
  listLoadedThreads(
    input: CodexAppServerLoadedThreadListInput,
  ): Effect.Effect<CodexAppServerLoadedThreadListResponse, CodexAppServerServiceError>;
  listThreads(
    input: CodexAppServerThreadListInput,
  ): Effect.Effect<CodexAppServerThreadListResponse, CodexAppServerServiceError>;
  notifications(
    input: CodexAppServerRuntimeInput,
  ): Effect.Effect<CodexAppServerProtocolMessage[], CodexAppServerServiceError>;
  requests(
    input: CodexAppServerRuntimeInput,
  ): Effect.Effect<CodexAppServerProtocolMessage[], CodexAppServerServiceError>;
  respond(input: CodexAppServerRespondInput): Effect.Effect<void, CodexAppServerServiceError>;
};
export type CodexAppServerRuntimeInput = {
  runtimeId: string;
};
export const createCodexAppServerService = (
  codexAppServerPort: CodexAppServerPort,
): CodexAppServerService => ({
  request: (input) => codexAppServerPort.request(input),
  listLoadedThreads: (input) => codexAppServerPort.listLoadedThreads(input),
  listThreads: (input) => codexAppServerPort.listThreads(input),
  notifications: (input) => codexAppServerPort.drainNotifications(input.runtimeId),
  requests: (input) => codexAppServerPort.drainServerRequests(input.runtimeId),
  respond: (input) => codexAppServerPort.respond(input),
});
