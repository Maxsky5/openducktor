import type {
  CodexAppServerRuntimeInput,
  CodexAppServerService,
} from "../../application/runtimes/codex-app-server-service";
import { HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerRequestInput,
  CodexAppServerRequestMethod,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";
import { CODEX_APP_SERVER_REQUEST_METHODS } from "../../ports/codex-app-server-port";
import {
  type CodexAppServerRequestParams,
  type CodexAppServerRespondError,
  type CodexAppServerRespondResult,
  isCodexAppServerJsonValue,
} from "../../ports/codex-app-server-protocol";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

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

const requireRequestId = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HostValidationError({
      message: "requestId must be a non-negative integer.",
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
): HostCommandHandlers => ({
  codex_app_server_request: (args) => codexAppServerService.request(parseRequestInput(args)),
  codex_app_server_notifications: (args) =>
    codexAppServerService.notifications(parseRuntimeInput(args, "codex_app_server_notifications")),
  codex_app_server_requests: (args) =>
    codexAppServerService.requests(parseRuntimeInput(args, "codex_app_server_requests")),
  codex_app_server_respond: (args) => codexAppServerService.respond(parseRespondInput(args)),
});
