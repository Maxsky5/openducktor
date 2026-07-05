import type {
  CodexJsonRpcRequest,
  CodexJsonRpcTransportFactory,
  CodexPolicyLogEntry,
} from "@openducktor/adapters-codex-app-server";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import type { CodexAppServerRequestId } from "@openducktor/contracts";
import { subscribeCodexAppServerEvents } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { host } from "../operations/shared/host";
import { runtimeCatalogQueryKeys } from "../queries/runtime-catalog";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";
import { hostRepoRuntimeResolver } from "./host-repo-runtime-resolver";

const isSkillsChangedNotification = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return false;
  }
  return (message as { method?: unknown }).method === "skills/changed";
};

const isSkillCatalogQueryKey = (queryKey: readonly unknown[]): boolean => {
  const [scope, resource] = queryKey;
  return scope === runtimeCatalogQueryKeys.all[0] && resource === "skills";
};

const invalidateSkillCatalogQueries = (): void => {
  void appQueryClient.invalidateQueries({
    predicate: (query) => isSkillCatalogQueryKey(query.queryKey),
  });
};

const createCodexHostTransportFactory = (): CodexJsonRpcTransportFactory => {
  return (runtimeId) => ({
    request: async <Response = unknown>(request: CodexJsonRpcRequest) =>
      host.codexAppServerRequest(runtimeId, request.method, request.params) as Promise<Response>,
  });
};

const logCodexSessionPolicy = (entry: CodexPolicyLogEntry): void => {
  console.info("[OpenDucktor] Codex session policy", entry);
};

export const createCodexAppServerRuntimeAdapter = (): AgentRuntimeAdapter =>
  new CodexAppServerAdapter({
    repoRuntimeResolver: hostRepoRuntimeResolver,
    transportFactory: createCodexHostTransportFactory(),
    takeBufferedEvents: async (runtimeId: string) => {
      return host.takeCodexAppServerBufferedEvents(runtimeId);
    },
    subscribeEvents: (runtimeId, listener) => {
      const subscribe = subscribeCodexAppServerEvents;
      if (!subscribe) {
        throw new Error("Codex app-server event subscriptions are unavailable.");
      }
      return subscribe((payload) => {
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          return;
        }
        const event = payload as { runtimeId?: unknown; kind?: unknown; message?: unknown };
        if (event.runtimeId !== runtimeId) {
          return;
        }
        if (event.kind !== "notification" && event.kind !== "server_request") {
          return;
        }
        if (event.kind === "notification" && isSkillsChangedNotification(event.message)) {
          invalidateSkillCatalogQueries();
        }
        listener({ runtimeId, kind: event.kind, message: event.message });
      });
    },
    respondServerRequest: async (
      runtimeId: string,
      requestId: CodexAppServerRequestId,
      result,
      error,
    ) => {
      await host.codexAppServerRespond(runtimeId, requestId, result, error);
    },
    logSessionPolicy: logCodexSessionPolicy,
  });
