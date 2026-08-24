import type { Readable, Writable } from "node:stream";
import type { Effect } from "effect";
import type {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { CodexAppServerStreamEvent } from "../../ports/codex-app-server-port";
import type {
  CodexAppServerClientNotification,
  CodexAppServerRequestMethod,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-protocol";
import type { CodexAppServerTransport } from "./codex-app-server-transport-registry";

export type CodexChildProcess = {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: "error", listener: (error: Error) => void): void;
  once(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
};

export type CodexTransportBaseError = HostOperationError | HostResourceError;
export type CodexAppServerTransportError = CodexTransportBaseError | HostValidationError;

export type CodexAppServerChildTransport = CodexAppServerTransport & {
  notify(
    notification: CodexAppServerClientNotification,
  ): Effect.Effect<void, CodexAppServerTransportError>;
  rejectPendingRequestsForShutdown(): Effect.Effect<void, never>;
  close(): Effect.Effect<void, never>;
};

export type CodexAppServerEventEmitter = (event: CodexAppServerStreamEvent) => void;

export type PendingCodexAppServerRequest = {
  method: CodexAppServerRequestMethod;
  resolve(value: CodexAppServerRequestResult): void;
  reject(error: Error): void;
};
