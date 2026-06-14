import type {
  CodexJsonRpcRequest,
  CodexJsonRpcTransportFactory,
} from "@openducktor/adapters-codex-app-server";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentEnginePort,
  AgentRuntimeDefinition,
  AgentSessionPort,
  AgentWorkspaceInspectionPort,
  RepoRuntimeRef,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND, validateRuntimeDefinitionForOpenDucktor } from "@/lib/agent-runtime";
import { subscribeCodexAppServerEvents } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { host } from "./operations/shared/host";
import type { RuntimeCatalogAdapter } from "./operations/shared/runtime-catalog";
import { agentSessionRuntimeQueryKeys } from "./queries/agent-session-runtime";
import { runtimeCatalogQueryKeys } from "./queries/runtime-catalog";

type RegisteredRuntimeAdapter = AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort &
  RuntimeCatalogAdapter & {
    getRuntimeDefinition(): AgentRuntimeDefinition;
  };

type AgentRuntimeRegistry = {
  defaultRuntimeKind: RuntimeKind;
  registeredRuntimeKinds: RuntimeKind[];
  getAdapter: (runtimeKind: RuntimeKind) => RegisteredRuntimeAdapter;
  getRuntimeDefinition: (runtimeKind: RuntimeKind) => AgentRuntimeDefinition;
  startRepoRuntime: (ref: RepoRuntimeRef) => Promise<RuntimeInstanceSummary>;
  createAgentEngine: () => AgentEnginePort;
};

type HostRepoRuntimeResolver = {
  ensureRepoRuntime(ref: RepoRuntimeRef): Promise<RuntimeInstanceSummary>;
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RuntimeInstanceSummary>;
};

const hostRepoRuntimeResolver: HostRepoRuntimeResolver = {
  ensureRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeEnsure(repoPath, runtimeKind);
  },
  requireRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeRequire(repoPath, runtimeKind);
  },
};

export { DEFAULT_RUNTIME_KIND };

const isSkillsChangedNotification = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return false;
  }
  return (message as { method?: unknown }).method === "skills/changed";
};

const isSkillCatalogQueryKey = (queryKey: readonly unknown[]): boolean => {
  const [scope, resource] = queryKey;
  return (
    (scope === runtimeCatalogQueryKeys.all[0] && resource === "skills") ||
    (scope === agentSessionRuntimeQueryKeys.all[0] && resource === "skills")
  );
};

const invalidateSkillCatalogQueries = (): void => {
  void appQueryClient.invalidateQueries({
    predicate: (query) => isSkillCatalogQueryKey(query.queryKey),
  });
};

export const createAgentRuntimeRegistry = (): AgentRuntimeRegistry => {
  const codexTransportFactory: CodexJsonRpcTransportFactory = (runtimeId) => ({
    request: async <Response = unknown>(request: CodexJsonRpcRequest) =>
      host.codexAppServerRequest(runtimeId, request.method, request.params) as Promise<Response>,
  });
  const opencodeAdapter = new OpencodeSdkAdapter({
    repoRuntimeResolver: hostRepoRuntimeResolver,
  }) as RegisteredRuntimeAdapter;
  const codexAdapter = new CodexAppServerAdapter({
    repoRuntimeResolver: hostRepoRuntimeResolver,
    transportFactory: codexTransportFactory,
    drainServerRequests: async (runtimeId: string) => {
      return host.codexAppServerRequests(runtimeId) as Promise<unknown[]>;
    },
    drainNotifications: async (runtimeId: string) => {
      return host.codexAppServerNotifications(runtimeId) as Promise<unknown[]>;
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
    respondServerRequest: async (runtimeId: string, requestId: number, result, error) => {
      await host.codexAppServerRespond(runtimeId, requestId, result, error);
    },
  }) as RegisteredRuntimeAdapter;
  const adapters = new Map<RuntimeKind, RegisteredRuntimeAdapter>([
    ["opencode", opencodeAdapter],
    ["codex", codexAdapter],
  ]);
  const registeredRuntimeKinds = Array.from(adapters.keys());

  const getAdapter = (runtimeKind: RuntimeKind): RegisteredRuntimeAdapter => {
    const adapter = adapters.get(runtimeKind);
    if (!adapter) {
      throw new Error(`Unsupported agent runtime '${runtimeKind}'.`);
    }
    return adapter;
  };

  const getRuntimeDefinition = (runtimeKind: RuntimeKind): AgentRuntimeDefinition => {
    return getAdapter(runtimeKind).getRuntimeDefinition();
  };

  for (const runtimeKind of registeredRuntimeKinds) {
    const definition = getRuntimeDefinition(runtimeKind);
    const validationErrors = validateRuntimeDefinitionForOpenDucktor(definition);
    if (validationErrors.length > 0) {
      throw new Error(
        `Runtime '${definition.kind}' is incompatible with OpenDucktor: ${validationErrors.join("; ")}`,
      );
    }
  }

  return {
    defaultRuntimeKind: DEFAULT_RUNTIME_KIND,
    registeredRuntimeKinds,
    getAdapter,
    getRuntimeDefinition,
    startRepoRuntime: hostRepoRuntimeResolver.ensureRepoRuntime,
    createAgentEngine: () => createRuntimeRegistryAgentEngine(getAdapter, registeredRuntimeKinds),
  };
};

const requireInputRuntimeKind = (
  runtimeKind: RuntimeKind | undefined,
  operation: string,
): RuntimeKind => {
  if (runtimeKind) {
    return runtimeKind;
  }
  throw new Error(`Runtime kind is required for ${operation} requests.`);
};

const createRuntimeRegistryAgentEngine = (
  getAdapter: (runtimeKind: RuntimeKind) => RegisteredRuntimeAdapter,
  registeredRuntimeKinds: RuntimeKind[],
): AgentEnginePort => {
  const adapterFor = (
    runtimeKind: RuntimeKind | undefined,
    operation: string,
  ): RegisteredRuntimeAdapter => getAdapter(requireInputRuntimeKind(runtimeKind, operation));

  return {
    async startSession(input) {
      const runtimeKind = requireInputRuntimeKind(input.runtimeKind, "session start");
      return getAdapter(runtimeKind).startSession(input);
    },
    async resumeSession(input) {
      const runtimeKind = requireInputRuntimeKind(input.runtimeKind, "session resume");
      return getAdapter(runtimeKind).resumeSession(input);
    },
    releaseSession: (input) =>
      adapterFor(input.runtimeKind, "session release").releaseSession(input),
    async forkSession(input) {
      const runtimeKind = requireInputRuntimeKind(input.runtimeKind, "session fork");
      return getAdapter(runtimeKind).forkSession(input);
    },
    listRuntimeDefinitions: () =>
      registeredRuntimeKinds.map((runtimeKind) => getAdapter(runtimeKind).getRuntimeDefinition()),
    listAvailableModels: (input) =>
      adapterFor(input.runtimeKind, "model catalog").listAvailableModels(input),
    listAvailableSlashCommands: (input) =>
      adapterFor(input.runtimeKind, "slash command catalog").listAvailableSlashCommands(input),
    listAvailableSkills: (input) =>
      adapterFor(input.runtimeKind, "skill catalog").listAvailableSkills(input),
    searchFiles: (input) => adapterFor(input.runtimeKind, "file search").searchFiles(input),
    listLiveAgentSessions: (input) =>
      adapterFor(input.runtimeKind, "live agent session discovery").listLiveAgentSessions(input),
    listSessionPresence: (input) =>
      adapterFor(input.runtimeKind, "live session snapshot discovery").listSessionPresence(input),
    readSessionPresence: (input) =>
      adapterFor(input.runtimeKind, "live session snapshot read").readSessionPresence(input),
    loadSessionHistory: (input) =>
      adapterFor(input.runtimeKind, "session history").loadSessionHistory(input),
    loadSessionTodos: (input) =>
      adapterFor(input.runtimeKind, "session todos").loadSessionTodos(input),
    updateSessionModel: (input) =>
      adapterFor(input.runtimeKind, "session model update").updateSessionModel(input),
    sendUserMessage: (input) =>
      adapterFor(input.runtimeKind, "user message send").sendUserMessage(input),
    replyApproval: (input) => adapterFor(input.runtimeKind, "approval reply").replyApproval(input),
    replyQuestion: (input) => adapterFor(input.runtimeKind, "question reply").replyQuestion(input),
    subscribeEvents: (input, listener) =>
      adapterFor(input.runtimeKind, "session event subscription").subscribeEvents(input, listener),
    stopSession: (input) => adapterFor(input.runtimeKind, "session stop").stopSession(input),
    loadSessionDiff: (input) =>
      adapterFor(input.runtimeKind, "session diff").loadSessionDiff(input),
    loadFileStatus: (input) => adapterFor(input.runtimeKind, "file status").loadFileStatus(input),
  };
};
