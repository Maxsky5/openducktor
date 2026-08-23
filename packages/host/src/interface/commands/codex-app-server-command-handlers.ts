import { Effect } from "effect";
import type {
  CodexAppServerService,
  CodexAppServerServiceError,
} from "../../application/runtimes/codex-app-server-service";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../../composition/host-lifecycle";
import { type HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerRequestInput,
  CodexAppServerRequestMethod,
} from "../../ports/codex-app-server-port";
import { CODEX_APP_SERVER_REQUEST_METHODS } from "../../ports/codex-app-server-port";
import type { CodexAppServerRequestResult } from "../../ports/codex-app-server-protocol";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";
import {
  parseCodexAppServerClientRequest,
  jsonValueSchema,
  hasRuntimeType,
} from "@openducktor/contracts";

type CodexAppServerCommandHandlerOptions = {
  logger?: HostLifecycleLogger;
  onBackgroundFailure(failure: HostOperationError): Effect.Effect<void, never>;
};

const defaultCodexAppServerCommandHandlerOptions: CodexAppServerCommandHandlerOptions = {
  onBackgroundFailure: () => Effect.void,
};

const CODEX_POLICY_REQUEST_METHODS = new Set<CodexAppServerRequestMethod>([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "turn/start",
]);

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordFromValue = (value: unknown, label: string): Record<string, unknown> => {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success || !isRecordValue(parsed.data)) {
    throw new HostValidationError({
      message: `${label} must be an object.`,
      field: label,
      ...(!parsed.success ? { cause: parsed.error } : undefined),
    });
  }
  return parsed.data;
};

const stringField = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];
  return hasRuntimeType(value, "string") && value.trim().length > 0 ? value : undefined;
};

const logValue = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = jsonValueSchema.parse(value);
  if (hasRuntimeType(parsed, "string") && parsed.trim().length > 0) {
    return parsed;
  }
  if (hasRuntimeType(parsed, "boolean") || hasRuntimeType(parsed, "number")) {
    return String(parsed);
  }
  if (parsed === null) {
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
  return hasRuntimeType(firstWritableRoot, "string") && firstWritableRoot.trim().length > 0
    ? firstWritableRoot
    : undefined;
};

const threadIdFromResult = (result: CodexAppServerRequestResult): string | undefined => {
  const resultRecord = recordFromValue(result, "Codex app-server result");
  if (!isRecordValue(resultRecord.thread)) {
    return undefined;
  }
  return stringField(resultRecord.thread, "id");
};

const logCodexPolicyRequest = (
  logger: HostLifecycleLogger | undefined,
  input: CodexAppServerRequestInput,
  result: CodexAppServerRequestResult,
): Effect.Effect<void, HostOperationError> => {
  if (!logger || !CODEX_POLICY_REQUEST_METHODS.has(input.method)) {
    return Effect.void;
  }
  const params = recordFromValue(input.params, `Codex app-server ${input.method} params`);
  const resultRecord = recordFromValue(result, `Codex app-server ${input.method} result`);
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

  return writeHostLifecycleLog(
    logger,
    "info",
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

const parseRequestInput = (
  args: Record<string, unknown> | undefined,
): CodexAppServerRequestInput => {
  const record = requireRecord(args, "codex_app_server_request input");
  const runtimeId = requireString(record.runtimeId, "runtimeId");
  const method = requireCodexRequestMethod(record.method);
  const parsedParams = jsonValueSchema.safeParse(record.params);
  if (!parsedParams.success) {
    throw new HostValidationError({
      message: "params must be JSON-serializable.",
      field: "params",
      cause: parsedParams.error,
      details: { method },
    });
  }
  let request;
  try {
    request = parseCodexAppServerClientRequest({ method, params: parsedParams.data });
  } catch (cause) {
    throw new HostValidationError({
      message: `Invalid Codex app-server request params for method ${method}`,
      field: "params",
      cause,
      details: { method },
    });
  }
  return {
    runtimeId,
    ...request,
  };
};

const optionalNullableString = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined || value === null) {
    return value;
  }
  return requireString(value, field);
};

const optionalNullablePositiveInteger = (
  value: unknown,
  field: string,
): number | null | undefined => {
  if (value === undefined || value === null) {
    return value;
  }
  if (!hasRuntimeType(value, "number") || !Number.isInteger(value) || value <= 0) {
    throw new HostValidationError({
      message: `${field} must be a positive integer.`,
      field,
    });
  }
  return value;
};

const optionalNullableLiteral = <Value extends string>(
  value: unknown,
  field: string,
  allowed: readonly Value[],
): Value | null | undefined => {
  if (value === undefined || value === null) {
    return value;
  }
  const parsed = requireString(value, field);
  const match = allowed.find((candidate) => candidate === parsed);
  if (!match) {
    throw new HostValidationError({
      message: `${field} must be one of: ${allowed.join(", ")}.`,
      field,
    });
  }
  return match;
};

const requestCodexAppServer = (
  service: CodexAppServerService,
  input: CodexAppServerRequestInput,
): Effect.Effect<CodexAppServerRequestResult, CodexAppServerServiceError> => {
  if (input.method !== "thread/turns/list") {
    return service.request(input);
  }

  const params = recordFromValue(input.params, "Codex app-server thread/turns/list params");
  const cursor = optionalNullableString(params.cursor, "cursor");
  const limit = optionalNullablePositiveInteger(params.limit, "limit");
  const sortDirection = optionalNullableLiteral(params.sortDirection, "sortDirection", [
    "asc",
    "desc",
  ]);
  const itemsView = optionalNullableLiteral(params.itemsView, "itemsView", [
    "notLoaded",
    "summary",
    "full",
  ]);
  return service.listThreadTurns({
    runtimeId: input.runtimeId,
    threadId: requireString(params.threadId, "threadId"),
    ...(cursor !== undefined ? { cursor } : undefined),
    ...(limit !== undefined ? { limit } : undefined),
    ...(sortDirection !== undefined ? { sortDirection } : undefined),
    ...(itemsView !== undefined ? { itemsView } : undefined),
  });
};

export const createCodexAppServerCommandHandlers = (
  codexAppServerService: CodexAppServerService,
  options: CodexAppServerCommandHandlerOptions = defaultCodexAppServerCommandHandlerOptions,
): HostCommandHandlers => ({
  codex_app_server_request: (args) => {
    const input = parseRequestInput(args);
    return requestCodexAppServer(codexAppServerService, input).pipe(
      Effect.tap((result) =>
        Effect.either(logCodexPolicyRequest(options.logger, input, result)).pipe(
          Effect.flatMap((loggingResult) =>
            loggingResult._tag === "Left"
              ? options.onBackgroundFailure(loggingResult.left)
              : Effect.void,
          ),
        ),
      ),
    );
  },
});
