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
  AgentModelSelection,
  AgentRuntimeDefinition,
  AgentSessionPort,
  AgentWorkspaceInspectionPort,
  RepoRuntimeRef,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND, validateRuntimeDefinitionForOpenDucktor } from "@/lib/agent-runtime";
import { subscribeCodexAppServerEvents } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
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

const requireListedRuntime = async (
  { repoPath, runtimeKind }: RepoRuntimeRef,
  predicate: (runtime: RuntimeInstanceSummary) => boolean,
  errorDetails: string,
): Promise<RuntimeInstanceSummary> => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  const runtimes = await host.runtimeList(repoPath, runtimeKind);
  const runtime = runtimes.find(
    (entry) =>
      entry.kind === runtimeKind &&
      normalizeWorkingDirectory(entry.repoPath) === normalizedRepoPath &&
      predicate(entry),
  );
  if (!runtime) {
    throw new Error(errorDetails);
  }
  return runtime;
};

const requireRepoRuntime = (ref: RepoRuntimeRef): Promise<RuntimeInstanceSummary> =>
  requireListedRuntime(
    ref,
    () => true,
    `No live repo runtime found for repo '${ref.repoPath}', runtime '${ref.runtimeKind}'.`,
  );

const hostRepoRuntimeResolver: HostRepoRuntimeResolver = {
  ensureRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeEnsure(repoPath, runtimeKind);
  },
  requireRepoRuntime,
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
    createAgentEngine: () => new RuntimeRegistryAgentEngine(getAdapter, registeredRuntimeKinds),
  };
};

class RuntimeRegistryAgentEngine implements AgentEnginePort {
  constructor(
    private readonly getAdapter: (runtimeKind: RuntimeKind) => RegisteredRuntimeAdapter,
    private readonly registeredRuntimeKinds: RuntimeKind[],
  ) {
    this.startSession = this.startSession.bind(this);
    this.resumeSession = this.resumeSession.bind(this);
    this.releaseSession = this.releaseSession.bind(this);
    this.forkSession = this.forkSession.bind(this);
    this.listRuntimeDefinitions = this.listRuntimeDefinitions.bind(this);
    this.listAvailableModels = this.listAvailableModels.bind(this);
    this.listAvailableSlashCommands = this.listAvailableSlashCommands.bind(this);
    this.listAvailableSkills = this.listAvailableSkills.bind(this);
    this.searchFiles = this.searchFiles.bind(this);
    this.listLiveAgentSessions = this.listLiveAgentSessions.bind(this);
    this.listSessionPresence = this.listSessionPresence.bind(this);
    this.readSessionPresence = this.readSessionPresence.bind(this);
    this.loadSessionHistory = this.loadSessionHistory.bind(this);
    this.loadSessionTodos = this.loadSessionTodos.bind(this);
    this.updateSessionModel = this.updateSessionModel.bind(this);
    this.sendUserMessage = this.sendUserMessage.bind(this);
    this.replyApproval = this.replyApproval.bind(this);
    this.replyQuestion = this.replyQuestion.bind(this);
    this.subscribeEvents = this.subscribeEvents.bind(this);
    this.stopSession = this.stopSession.bind(this);
    this.loadSessionDiff = this.loadSessionDiff.bind(this);
    this.loadFileStatus = this.loadFileStatus.bind(this);
  }

  async startSession(input: Parameters<AgentEnginePort["startSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model);
    const summary = await this.getAdapter(runtimeKind).startSession(input);
    return {
      ...summary,
      runtimeKind,
    };
  }

  async resumeSession(input: Parameters<AgentEnginePort["resumeSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model);
    const summary = await this.getAdapter(runtimeKind).resumeSession(input);
    return {
      ...summary,
      runtimeKind,
    };
  }

  async releaseSession(input: Parameters<AgentEnginePort["releaseSession"]>[0]): Promise<void> {
    await this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session release"),
    ).releaseSession(input);
  }

  async forkSession(input: Parameters<AgentEnginePort["forkSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model);
    const summary = await this.getAdapter(runtimeKind).forkSession(input);
    return {
      ...summary,
      runtimeKind,
    };
  }

  listRuntimeDefinitions(): AgentRuntimeDefinition[] {
    return this.registeredRuntimeKinds.map((runtimeKind) =>
      this.getAdapter(runtimeKind).getRuntimeDefinition(),
    );
  }

  listAvailableModels(input: Parameters<AgentEnginePort["listAvailableModels"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "model catalog"),
    ).listAvailableModels(input);
  }

  listAvailableSlashCommands(input: Parameters<AgentEnginePort["listAvailableSlashCommands"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "slash command catalog"),
    ).listAvailableSlashCommands(input);
  }

  listAvailableSkills(input: Parameters<AgentEnginePort["listAvailableSkills"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "skill catalog"),
    ).listAvailableSkills(input);
  }

  searchFiles(input: Parameters<AgentEnginePort["searchFiles"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "file search"),
    ).searchFiles(input);
  }

  listLiveAgentSessions(input: Parameters<AgentEnginePort["listLiveAgentSessions"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "live agent session discovery"),
    ).listLiveAgentSessions(input);
  }

  listSessionPresence(input: Parameters<AgentEnginePort["listSessionPresence"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "live session snapshot discovery"),
    ).listSessionPresence(input);
  }

  readSessionPresence(input: Parameters<AgentEnginePort["readSessionPresence"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "live session snapshot read"),
    ).readSessionPresence(input);
  }

  loadSessionHistory(input: Parameters<AgentEnginePort["loadSessionHistory"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session history"),
    ).loadSessionHistory(input);
  }

  loadSessionTodos(input: Parameters<AgentEnginePort["loadSessionTodos"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session todos"),
    ).loadSessionTodos(input);
  }

  updateSessionModel(input: Parameters<AgentEnginePort["updateSessionModel"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session model update"),
    ).updateSessionModel(input);
  }

  sendUserMessage(input: Parameters<AgentEnginePort["sendUserMessage"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "user message send"),
    ).sendUserMessage(input);
  }

  replyApproval(input: Parameters<AgentEnginePort["replyApproval"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "approval reply"),
    ).replyApproval(input);
  }

  replyQuestion(input: Parameters<AgentEnginePort["replyQuestion"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "question reply"),
    ).replyQuestion(input);
  }

  subscribeEvents(
    input: Parameters<AgentEnginePort["subscribeEvents"]>[0],
    listener: Parameters<AgentEnginePort["subscribeEvents"]>[1],
  ) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session event subscription"),
    ).subscribeEvents(input, listener);
  }

  async stopSession(input: Parameters<AgentEnginePort["stopSession"]>[0]): Promise<void> {
    await this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session stop"),
    ).stopSession(input);
  }

  loadSessionDiff(input: Parameters<AgentEnginePort["loadSessionDiff"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "session diff"),
    ).loadSessionDiff(input);
  }

  loadFileStatus(input: Parameters<AgentEnginePort["loadFileStatus"]>[0]) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "file status"),
    ).loadFileStatus(input);
  }

  private requireInputRuntimeKind(
    runtimeKind: RuntimeKind | undefined,
    operation: string,
  ): RuntimeKind {
    if (runtimeKind) {
      return runtimeKind;
    }
    throw new Error(`Runtime kind is required for ${operation} requests.`);
  }

  private resolveRuntimeKind(
    runtimeKind: RuntimeKind | undefined,
    model: AgentModelSelection | undefined,
  ): RuntimeKind {
    if (runtimeKind) {
      return runtimeKind;
    }
    if (model?.runtimeKind) {
      return model.runtimeKind;
    }
    throw new Error("Runtime kind is required to select an agent runtime adapter.");
  }
}
