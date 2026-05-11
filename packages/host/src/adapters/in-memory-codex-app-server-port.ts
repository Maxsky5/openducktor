import type {
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../ports/codex-app-server-port";

export type CodexAppServerTransport = {
  request(input: Omit<CodexAppServerRequestInput, "runtimeId">): Promise<unknown>;
  drainNotifications(): Promise<unknown[]>;
  drainServerRequests(): Promise<unknown[]>;
  respond(input: Omit<CodexAppServerRespondInput, "runtimeId">): Promise<void>;
};

export type InMemoryCodexAppServerPort = CodexAppServerPort & {
  registerTransport(runtimeId: string, transport: CodexAppServerTransport): void;
  unregisterTransport(runtimeId: string): void;
};

export const createInMemoryCodexAppServerPort = (): InMemoryCodexAppServerPort => {
  const transports = new Map<string, CodexAppServerTransport>();

  const requireTransport = (runtimeId: string): CodexAppServerTransport => {
    const transport = transports.get(runtimeId);
    if (!transport) {
      throw new Error(`Codex app-server transport not found for runtime ${runtimeId}`);
    }
    return transport;
  };

  return {
    registerTransport(runtimeId, transport) {
      if (transports.has(runtimeId)) {
        throw new Error(`Codex app-server transport already registered for runtime ${runtimeId}`);
      }
      transports.set(runtimeId, transport);
    },
    unregisterTransport(runtimeId) {
      transports.delete(runtimeId);
    },
    async request({ runtimeId, method, params }) {
      return requireTransport(runtimeId).request({
        method,
        ...(params !== undefined ? { params } : {}),
      });
    },
    async drainNotifications(runtimeId) {
      return requireTransport(runtimeId).drainNotifications();
    },
    async drainServerRequests(runtimeId) {
      return requireTransport(runtimeId).drainServerRequests();
    },
    async respond({ runtimeId, requestId, result, error }) {
      await requireTransport(runtimeId).respond({
        requestId,
        ...(result !== undefined ? { result } : {}),
        ...(error !== undefined ? { error } : {}),
      });
    },
  };
};
