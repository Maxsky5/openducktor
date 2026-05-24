import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { Effect } from "effect";
import type {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { CodexAppServerProtocolMessage } from "../../ports/codex-app-server-port";
import type {
  CodexAppServerClientNotification,
  CodexAppServerRequestMethod,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-protocol";
import type { CodexAppServerTransport } from "./codex-app-server-transport-registry";

export type CodexChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export type CodexTransportBaseError = HostOperationError | HostResourceError;
export type CodexAppServerTransportError = CodexTransportBaseError | HostValidationError;

export type CodexAppServerChildTransport = CodexAppServerTransport & {
  notify(
    notification: CodexAppServerClientNotification,
  ): Effect.Effect<void, CodexAppServerTransportError>;
  close(): Effect.Effect<void, never>;
};

export type CodexAppServerStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: CodexAppServerProtocolMessage;
};

export type CodexAppServerEventEmitter = (event: CodexAppServerStreamEvent) => void;

export type PendingCodexAppServerRequest = {
  method: CodexAppServerRequestMethod;
  resolve(value: CodexAppServerRequestResult): void;
  reject(error: Error): void;
};
