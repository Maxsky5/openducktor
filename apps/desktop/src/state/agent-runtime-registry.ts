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
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { RuntimeCatalogAdapter } from "./operations/runtime-catalog";

type RegisteredRuntimeAdapter = AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort &
  RuntimeCatalogAdapter & {
    getRuntimeDefinition(): AgentRuntimeDefinition;
  };

export type AgentRuntimeRegistry = {
  defaultRuntimeKind: RuntimeKind;
  registeredRuntimeKinds: RuntimeKind[];
  getAdapter: (runtimeKind: RuntimeKind) => RegisteredRuntimeAdapter;
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

  return {
    defaultRuntimeKind: DEFAULT_RUNTIME_KIND,
    registeredRuntimeKinds,
    getAdapter,
    createAgentEngine: () =>
      new RuntimeRegistryAgentEngine(getAdapter, registeredRuntimeKinds, DEFAULT_RUNTIME_KIND),
  };
};

class RuntimeRegistryAgentEngine implements AgentEnginePort {
  private readonly runtimeKindsBySessionId = new Map<string, RuntimeKind>();

  constructor(
    private readonly getAdapter: (runtimeKind: RuntimeKind) => RegisteredRuntimeAdapter,
    private readonly registeredRuntimeKinds: RuntimeKind[],
    private readonly defaultRuntimeKind: RuntimeKind,
  ) {}

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

  listRuntimeDefinitions(): AgentRuntimeDefinition[] {
    return this.registeredRuntimeKinds.map((runtimeKind) =>
      this.getAdapter(runtimeKind).getRuntimeDefinition(),
    );
  }

  listAvailableModels(input: Parameters<AgentEnginePort["listAvailableModels"]>[0]) {
    return this.getAdapter(input.runtimeKind ?? this.defaultRuntimeKind).listAvailableModels(input);
  }

  hasSession(sessionId: string): boolean {
    return this.discoverSessionRuntimeKind(sessionId) !== null;
  }

  loadSessionHistory(input: Parameters<AgentEnginePort["loadSessionHistory"]>[0]) {
    return this.getAdapter(input.runtimeKind ?? this.defaultRuntimeKind).loadSessionHistory(input);
  }

  loadSessionTodos(input: Parameters<AgentEnginePort["loadSessionTodos"]>[0]) {
    return this.getAdapter(input.runtimeKind ?? this.defaultRuntimeKind).loadSessionTodos(input);
  }

  sendUserMessage(input: Parameters<AgentEnginePort["sendUserMessage"]>[0]) {
    return this.getAdapter(this.requireSessionRuntimeKind(input.sessionId)).sendUserMessage(input);
  }

  replyPermission(input: Parameters<AgentEnginePort["replyPermission"]>[0]) {
    return this.getAdapter(this.requireSessionRuntimeKind(input.sessionId)).replyPermission(input);
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
    return this.getAdapter(input.runtimeKind ?? this.defaultRuntimeKind).loadSessionDiff(input);
  }

  loadFileStatus(input: Parameters<AgentEnginePort["loadFileStatus"]>[0]) {
    return this.getAdapter(input.runtimeKind ?? this.defaultRuntimeKind).loadFileStatus(input);
  }

  private resolveRuntimeKind(
    runtimeKind: RuntimeKind | undefined,
    model: AgentModelSelection | undefined,
    sessionId?: string,
  ): RuntimeKind {
    return (
      runtimeKind ??
      model?.runtimeKind ??
      (sessionId ? this.runtimeKindsBySessionId.get(sessionId) : undefined) ??
      this.defaultRuntimeKind
    );
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
