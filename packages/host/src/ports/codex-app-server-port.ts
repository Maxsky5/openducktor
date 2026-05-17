import { Context, type Effect } from "effect";
import type {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";

export type CodexAppServerError = HostOperationError | HostResourceError | HostValidationError;

export type CodexAppServerRequestInput = {
  runtimeId: string;
  method: string;
  params?: unknown;
};
export type CodexAppServerRespondInput = {
  runtimeId: string;
  requestId: number;
  result?: unknown;
  error?: unknown;
};
export type CodexAppServerPort = {
  request(input: CodexAppServerRequestInput): Effect.Effect<unknown, CodexAppServerError>;
  drainNotifications(runtimeId: string): Effect.Effect<unknown[], CodexAppServerError>;
  drainServerRequests(runtimeId: string): Effect.Effect<unknown[], CodexAppServerError>;
  respond(input: CodexAppServerRespondInput): Effect.Effect<void, CodexAppServerError>;
};

export class CodexAppServerPortTag extends Context.Tag("@openducktor/host/CodexAppServerPort")<
  CodexAppServerPortTag,
  CodexAppServerPort
>() {}
