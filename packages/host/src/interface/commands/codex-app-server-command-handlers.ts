import { Effect } from "effect";
import type {
  CodexAppServerRuntimeInput,
  CodexAppServerService,
} from "../../application/runtimes/codex-app-server-service";
import type { HostLifecycleLogger } from "../../composition/host-lifecycle";
import { HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerRequestId,
  CodexAppServerRequestInput,
  CodexAppServerRequestMethod,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";
import { CODEX_APP_SERVER_REQUEST_METHODS } from "../../ports/codex-app-server-port";
import {
  type CodexAppServerRequestParams,
  type CodexAppServerRequestResult,
  type CodexAppServerRespondError,
  type CodexAppServerRespondResult,
  isCodexAppServerJsonValue,
} from "../../ports/codex-app-server-protocol";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

type CodexAppServerCommandHandlerOptions = {
  logger?: Pick<HostLifecycleLogger, "info">;
};

const CODEX_POLICY_REQUEST_METHODS = new Set<CodexAppServerRequestMethod>([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "turn/start",
]);

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordFromValue = (value: unknown): Record<string, unknown> =>
  isRecordValue(value) ? value : {};

const stringField = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const logValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return undefined;
};

const sandboxModeFromSandboxPolicy = (sandboxPolicy: unknown): string | undefined => {
  if (!isRecordValue(sandboxPolicy)) {
    return undefined;
  }
  switch (sandboxPolicy.type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "readOnly":
      return "read-only";
    case "workspaceWrite":
      return "workspace-write";
    case "externalSandbox":
      return "externalSandbox";
    default:
      return undefined;
  }
};

const networkAccessFromSandboxPolicy = (sandboxPolicy: unknown): string | undefined => {
  if (!isRecordValue(sandboxPolicy)) {
    return undefined;
  }
  if (sandboxPolicy.type === "dangerFullAccess") {
    return "unrestricted";
  }
  return logValue(sandboxPolicy.networkAccess);
};

const cwdFromSandboxPolicy = (sandboxPolicy: unknown): string | undefined => {
  if (!isRecordValue(sandboxPolicy) || !Array.isArray(sandboxPolicy.writableRoots)) {
    return undefined;
  }
  const firstWritableRoot = sandboxPolicy.writableRoots[0];
  return typeof firstWritableRoot === "string" && firstWritableRoot.trim().length > 0
    ? firstWritableRoot
    : undefined;
};

const threadIdFromResult = (result: unknown): string | undefined => {
  const resultRecord = recordFromValue(result);
  if (!isRecordValue(resultRecord.thread)) {
    return undefined;
  }
  return stringField(resultRecord.thread, "id");
};

const logCodexPolicyRequest = (
  logger: Pick<HostLifecycleLogger, "info"> | undefined,
  input: CodexAppServerRequestInput,
  result: CodexAppServerRequestResult,
): void => {
  if (!logger || !CODEX_POLICY_REQUEST_METHODS.has(input.method)) {
    return;
  }
  const params = recordFromValue(input.params);
  const resultRecord = recordFromValue(result);
  const resultSandbox = resultRecord.sandbox;
  const requestSandboxPolicy = params.sandboxPolicy;
  const sandboxPolicy = input.method === "turn/start" ? requestSandboxPolicy : resultSandbox;
  const sandboxMode =
    input.method === "turn/start"
      ? sandboxModeFromSandboxPolicy(requestSandboxPolicy)
      : (stringField(params, "sandbox") ?? sandboxModeFromSandboxPolicy(resultSandbox));
  const threadId =
    stringField(params, "threadId") ??
    threadIdFromResult(result) ??
    (input.method === "thread/start" ? undefined : "unknown");
  const cwd =
    stringField(params, "cwd") ??
    stringField(resultRecord, "cwd") ??
    cwdFromSandboxPolicy(sandboxPolicy);

  logger.info(
    [
      `Codex session policy ${input.method}`,
      `runtime=${input.runtimeId}`,
      `thread=${threadId ?? "unknown"}`,
      `cwd=${cwd ?? "unknown"}`,
      `sandboxMode=${sandboxMode ?? "unknown"}`,
      `approvalPolicy=${
        logValue(params.approvalPolicy) ?? logValue(resultRecord.approvalPolicy) ?? "unknown"
      }`,
      `promptReviewer=${
        logValue(params.approvalsReviewer) ?? logValue(resultRecord.approvalsReviewer) ?? "unknown"
      }`,
      `networkAccess=${networkAccessFromSandboxPolicy(sandboxPolicy) ?? "unknown"}`,
    ].join(" "),
  );
};

const isCodexRequestMethod = (method: string): method is CodexAppServerRequestMethod =>
  CODEX_APP_SERVER_REQUEST_METHODS.some((candidate) => candidate === method);

const requireCodexJsonValue = (value: unknown, context: string) => {
  if (!isCodexAppServerJsonValue(value)) {
    throw new HostValidationError({
      message: `${context} must be JSON-serializable.`,
      details: { context },
    });
  }
  return value;
};

const requireRequestId = (value: unknown): CodexAppServerRequestId => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HostValidationError({
      message: "requestId must be a non-empty string or non-negative integer.",
      field: "requestId",
      details: { value },
    });
  }

  return value;
};

const requireCodexRequestMethod = (value: unknown): CodexAppServerRequestMethod => {
  const method = requireString(value, "method");
  if (!isCodexRequestMethod(method)) {
    throw new HostValidationError({
      message: `Unsupported Codex app-server request method: ${method}`,
      field: "method",
      details: { method },
    });
  }
  return method;
};

const parseRuntimeInput = (
  args: Record<string, unknown> | undefined,
  label: string,
): CodexAppServerRuntimeInput => {
  const record = requireRecord(args, `${label} input`);
  return { runtimeId: requireString(record.runtimeId, "runtimeId") };
};

const parseRequestInput = (
  args: Record<string, unknown> | undefined,
): CodexAppServerRequestInput => {
  const record = requireRecord(args, "codex_app_server_request input");
  const params =
    record.params === undefined ? undefined : requireCodexJsonValue(record.params, "params");
  return {
    runtimeId: requireString(record.runtimeId, "runtimeId"),
    method: requireCodexRequestMethod(record.method),
    ...(params !== undefined ? { params: params as CodexAppServerRequestParams } : {}),
  };
};

const parseRespondInput = (
  args: Record<string, unknown> | undefined,
): CodexAppServerRespondInput => {
  const record = requireRecord(args, "codex_app_server_respond input");
  const result =
    record.result === undefined ? undefined : requireCodexJsonValue(record.result, "result");
  const error =
    record.error === undefined ? undefined : requireCodexJsonValue(record.error, "error");
  return {
    runtimeId: requireString(record.runtimeId, "runtimeId"),
    requestId: requireRequestId(record.requestId),
    ...(result !== undefined ? { result: result as CodexAppServerRespondResult } : {}),
    ...(error !== undefined ? { error: error as CodexAppServerRespondError } : {}),
  };
};

export const createCodexAppServerCommandHandlers = (
  codexAppServerService: CodexAppServerService,
  options: CodexAppServerCommandHandlerOptions = {},
): HostCommandHandlers => ({
  codex_app_server_request: (args) => {
    const input = parseRequestInput(args);
    return codexAppServerService
      .request(input)
      .pipe(
        Effect.tap((result) =>
          Effect.sync(() => logCodexPolicyRequest(options.logger, input, result)),
        ),
      );
  },
  codex_app_server_take_buffered_events: (args) =>
    codexAppServerService.takeBufferedEvents(
      parseRuntimeInput(args, "codex_app_server_take_buffered_events"),
    ),
  codex_app_server_respond: (args) => codexAppServerService.respond(parseRespondInput(args)),
});
