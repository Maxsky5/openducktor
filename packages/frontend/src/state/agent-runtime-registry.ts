import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentEnginePort,
  AgentModelSelection,
  AgentRuntimeDefinition,
  AgentSessionPort,
  AgentWorkspaceInspectionPort,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND, validateRuntimeDefinitionForOpenDucktor } from "@/lib/agent-runtime";
import type { RuntimeCatalogAdapter } from "./operations/shared/runtime-catalog";

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
  createAgentEngine: () => AgentEnginePort;
};

export { DEFAULT_RUNTIME_KIND };

export const createAgentRuntimeRegistry = (): AgentRuntimeRegistry => {
  const opencodeAdapter = new OpencodeSdkAdapter() as RegisteredRuntimeAdapter;
  const adapters = new Map<RuntimeKind, RegisteredRuntimeAdapter>([["opencode", opencodeAdapter]]);
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
    createAgentEngine: () => new RuntimeRegistryAgentEngine(getAdapter, registeredRuntimeKinds),
  };
};

class RuntimeRegistryAgentEngine implements AgentEnginePort {
  private readonly runtimeKindsBySessionId = new Map<string, RuntimeKind>();

  constructor(
    private readonly getAdapter: (runtimeKind: RuntimeKind) => RegisteredRuntimeAdapter,
    private readonly registeredRuntimeKinds: RuntimeKind[],
  ) {
    this.startSession = this.startSession.bind(this);
    this.resumeSession = this.resumeSession.bind(this);
    this.attachSession = this.attachSession.bind(this);
    this.detachSession = this.detachSession.bind(this);
    this.forkSession = this.forkSession.bind(this);
    this.listRuntimeDefinitions = this.listRuntimeDefinitions.bind(this);
    this.listAvailableModels = this.listAvailableModels.bind(this);
    this.listAvailableSlashCommands = this.listAvailableSlashCommands.bind(this);
    this.searchFiles = this.searchFiles.bind(this);
    this.listLiveAgentSessions = this.listLiveAgentSessions.bind(this);
    this.listLiveAgentSessionSnapshots = this.listLiveAgentSessionSnapshots.bind(this);
    this.hasSession = this.hasSession.bind(this);
    this.loadSessionHistory = this.loadSessionHistory.bind(this);
    this.loadSessionTodos = this.loadSessionTodos.bind(this);
    this.listLiveAgentSessionPendingInput = this.listLiveAgentSessionPendingInput.bind(this);
    this.updateSessionModel = this.updateSessionModel.bind(this);
    this.sendUserMessage = this.sendUserMessage.bind(this);
    this.replyPermission = this.replyPermission.bind(this);
    this.replyQuestion = this.replyQuestion.bind(this);
    this.subscribeEvents = this.subscribeEvents.bind(this);
    this.stopSession = this.stopSession.bind(this);
    this.loadSessionDiff = this.loadSessionDiff.bind(this);
    this.loadFileStatus = this.loadFileStatus.bind(this);
  }

  async startSession(input: Parameters<AgentEnginePort["startSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model);
    const summary = await this.getAdapter(runtimeKind).startSession(input);
    this.runtimeKindsBySessionId.set(summary.sessionId, runtimeKind);
    return {
      ...summary,
      runtimeKind,
    };
  }

  async resumeSession(input: Parameters<AgentEnginePort["resumeSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model, input.sessionId);
    const summary = await this.getAdapter(runtimeKind).resumeSession(input);
    this.runtimeKindsBySessionId.set(summary.sessionId, runtimeKind);
    return {
      ...summary,
      runtimeKind,
    };
  }

  async attachSession(input: Parameters<AgentEnginePort["attachSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model, input.sessionId);
    const summary = await this.getAdapter(runtimeKind).attachSession(input);
    this.runtimeKindsBySessionId.set(summary.sessionId, runtimeKind);
    return {
      ...summary,
      runtimeKind,
    };
  }

  async detachSession(sessionId: string): Promise<void> {
    const runtimeKind = this.requireSessionRuntimeKind(sessionId);
    await this.getAdapter(runtimeKind).detachSession(sessionId);
    this.runtimeKindsBySessionId.delete(sessionId);
  }

  async forkSession(input: Parameters<AgentEnginePort["forkSession"]>[0]) {
    const runtimeKind = this.resolveRuntimeKind(input.runtimeKind, input.model);
    const summary = await this.getAdapter(runtimeKind).forkSession(input);
    this.runtimeKindsBySessionId.set(summary.sessionId, runtimeKind);
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

  listLiveAgentSessionSnapshots(
    input: Parameters<AgentEnginePort["listLiveAgentSessionSnapshots"]>[0],
  ) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "live agent session snapshot discovery"),
    ).listLiveAgentSessionSnapshots(input);
  }

  hasSession(sessionId: string): boolean {
    return this.discoverSessionRuntimeKind(sessionId) !== null;
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

  listLiveAgentSessionPendingInput(
    input: Parameters<AgentEnginePort["listLiveAgentSessionPendingInput"]>[0],
  ) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "live agent session pending input"),
    ).listLiveAgentSessionPendingInput(input);
  }

  updateSessionModel(input: Parameters<AgentEnginePort["updateSessionModel"]>[0]) {
    return this.getAdapter(this.requireSessionRuntimeKind(input.sessionId)).updateSessionModel(
      input,
    );
  }

  sendUserMessage(input: Parameters<AgentEnginePort["sendUserMessage"]>[0]) {
    return this.getAdapter(this.requireSessionRuntimeKind(input.sessionId)).sendUserMessage(input);
  }

  replyPermission(input: Parameters<AgentEnginePort["replyPermission"]>[0]) {
    return this.getAdapter(this.requireSessionRuntimeKind(input.sessionId)).replyPermission(input);
  }

  replyRuntimeSessionPermission(
    input: Parameters<AgentEnginePort["replyRuntimeSessionPermission"]>[0],
  ) {
    return this.getAdapter(
      this.requireInputRuntimeKind(input.runtimeKind, "runtime session permission reply"),
    ).replyRuntimeSessionPermission(input);
  }

  replyQuestion(input: Parameters<AgentEnginePort["replyQuestion"]>[0]) {
    return this.getAdapter(this.requireSessionRuntimeKind(input.sessionId)).replyQuestion(input);
  }

  subscribeEvents(sessionId: string, listener: Parameters<AgentEnginePort["subscribeEvents"]>[1]) {
    return this.getAdapter(this.requireSessionRuntimeKind(sessionId)).subscribeEvents(
      sessionId,
      listener,
    );
  }

  async stopSession(sessionId: string): Promise<void> {
    const runtimeKind = this.requireSessionRuntimeKind(sessionId);
    await this.getAdapter(runtimeKind).stopSession(sessionId);
    this.runtimeKindsBySessionId.delete(sessionId);
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
    sessionId?: string,
  ): RuntimeKind {
    if (runtimeKind) {
      return runtimeKind;
    }
    if (model?.runtimeKind) {
      return model.runtimeKind;
    }
    if (sessionId) {
      return this.requireSessionRuntimeKind(sessionId);
    }
    throw new Error("Runtime kind is required to select an agent runtime adapter.");
  }

  private requireSessionRuntimeKind(sessionId: string): RuntimeKind {
    const resolvedRuntimeKind = this.discoverSessionRuntimeKind(sessionId);
    if (resolvedRuntimeKind) {
      return resolvedRuntimeKind;
    }
    throw new Error(`Runtime kind is unknown for session '${sessionId}'.`);
  }

  private discoverSessionRuntimeKind(sessionId: string): RuntimeKind | null {
    const cachedRuntimeKind = this.runtimeKindsBySessionId.get(sessionId);
    if (cachedRuntimeKind && this.getAdapter(cachedRuntimeKind).hasSession(sessionId)) {
      return cachedRuntimeKind;
    }

    for (const runtimeKind of this.registeredRuntimeKinds) {
      if (this.getAdapter(runtimeKind).hasSession(sessionId)) {
        this.runtimeKindsBySessionId.set(sessionId, runtimeKind);
        return runtimeKind;
      }
    }

    return null;
  }
}
