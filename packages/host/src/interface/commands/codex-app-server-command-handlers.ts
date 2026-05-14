import type {
  CodexAppServerRuntimeInput,
  CodexAppServerService,
} from "../../application/runtimes/codex-app-server-service";
import type {
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const requireRequestId = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("requestId must be a non-negative integer.");
  }

  return value;
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
  return {
    runtimeId: requireString(record.runtimeId, "runtimeId"),
    method: requireString(record.method, "method"),
    ...(record.params !== undefined ? { params: record.params } : {}),
  };
};

const parseRespondInput = (
  args: Record<string, unknown> | undefined,
): CodexAppServerRespondInput => {
  const record = requireRecord(args, "codex_app_server_respond input");
  return {
    runtimeId: requireString(record.runtimeId, "runtimeId"),
    requestId: requireRequestId(record.requestId),
    ...(record.result !== undefined ? { result: record.result } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
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
