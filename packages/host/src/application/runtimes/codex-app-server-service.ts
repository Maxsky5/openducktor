import type {
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";

export type CodexAppServerService = {
  request(input: CodexAppServerRequestInput): Promise<unknown>;
  notifications(input: CodexAppServerRuntimeInput): Promise<unknown[]>;
  requests(input: CodexAppServerRuntimeInput): Promise<unknown[]>;
  respond(input: CodexAppServerRespondInput): Promise<void>;
};

export type CodexAppServerRuntimeInput = {
  runtimeId: string;
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
    return codexAppServerPort.request(input);
  },
  async notifications(input) {
    return assertArray(
      await codexAppServerPort.drainNotifications(input.runtimeId),
      "codex_app_server_notifications",
    );
  },
  async requests(input) {
    return assertArray(
      await codexAppServerPort.drainServerRequests(input.runtimeId),
      "codex_app_server_requests",
    );
  },
  async respond(input) {
    return codexAppServerPort.respond(input);
  },
});
