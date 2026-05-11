import type {
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../ports/codex-app-server-port";

export type CodexAppServerService = {
  request(input: unknown): Promise<unknown>;
  notifications(input: unknown): Promise<unknown[]>;
  requests(input: unknown): Promise<unknown[]>;
  respond(input: unknown): Promise<void>;
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
};

const requireRequestId = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("requestId must be a non-negative integer.");
  }

  return value;
};

const parseRuntimeInput = (input: unknown, label: string): { runtimeId: string } => {
  const record = requireRecord(input, `${label} input`);
  return { runtimeId: requireString(record.runtimeId, "runtimeId") };
};

const parseRequestInput = (input: unknown): CodexAppServerRequestInput => {
  const record = requireRecord(input, "codex_app_server_request input");
  return {
    runtimeId: requireString(record.runtimeId, "runtimeId"),
    method: requireString(record.method, "method"),
    ...(record.params !== undefined ? { params: record.params } : {}),
  };
};

const parseRespondInput = (input: unknown): CodexAppServerRespondInput => {
  const record = requireRecord(input, "codex_app_server_respond input");
  return {
    runtimeId: requireString(record.runtimeId, "runtimeId"),
    requestId: requireRequestId(record.requestId),
    ...(record.result !== undefined ? { result: record.result } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
  };
};

const assertArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must return an array.`);
  }

  return value;
};

export const createCodexAppServerService = (
  codexAppServerPort: CodexAppServerPort,
): CodexAppServerService => ({
  async request(input) {
    return codexAppServerPort.request(parseRequestInput(input));
  },
  async notifications(input) {
    const { runtimeId } = parseRuntimeInput(input, "codex_app_server_notifications");
    return assertArray(
      await codexAppServerPort.drainNotifications(runtimeId),
      "codex_app_server_notifications",
    );
  },
  async requests(input) {
    const { runtimeId } = parseRuntimeInput(input, "codex_app_server_requests");
    return assertArray(
      await codexAppServerPort.drainServerRequests(runtimeId),
      "codex_app_server_requests",
    );
  },
  async respond(input) {
    return codexAppServerPort.respond(parseRespondInput(input));
  },
});
