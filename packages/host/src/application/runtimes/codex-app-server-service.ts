import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerError,
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";

export type CodexAppServerServiceError = CodexAppServerError | HostValidationError;

export type CodexAppServerService = {
  request(input: CodexAppServerRequestInput): Effect.Effect<unknown, CodexAppServerServiceError>;
  notifications(
    input: CodexAppServerRuntimeInput,
  ): Effect.Effect<unknown[], CodexAppServerServiceError>;
  requests(input: CodexAppServerRuntimeInput): Effect.Effect<unknown[], CodexAppServerServiceError>;
  respond(input: CodexAppServerRespondInput): Effect.Effect<void, CodexAppServerServiceError>;
};
export type CodexAppServerRuntimeInput = {
  runtimeId: string;
};
const assertArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new HostValidationError({ message: `${label} must return an array.` });
  }
  return value;
};
export const createCodexAppServerService = (
  codexAppServerPort: CodexAppServerPort,
): CodexAppServerService => ({
  request: (input) => codexAppServerPort.request(input),
  notifications: (input) =>
    codexAppServerPort
      .drainNotifications(input.runtimeId)
      .pipe(Effect.map((value) => assertArray(value, "codex_app_server_notifications"))),
  requests: (input) =>
    codexAppServerPort
      .drainServerRequests(input.runtimeId)
      .pipe(Effect.map((value) => assertArray(value, "codex_app_server_requests"))),
  respond: (input) => codexAppServerPort.respond(input),
});
