import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { validateRuntimeDefinitionForOpenDucktor } from "@/lib/agent-runtime";
import { host } from "./operations/shared/host";
import {
  createHostRuntimeCatalogOperations,
  type RuntimeCatalogOperations,
} from "./operations/shared/runtime-catalog";
import type { AgentRuntimeAdapter } from "./runtime-adapters/agent-runtime-adapter";
import { createCodexAppServerRuntimeAdapter } from "./runtime-adapters/codex-app-server-runtime-adapter";
import { createOpenCodeRuntimeAdapter } from "./runtime-adapters/opencode-runtime-adapter";

type AgentRuntimeServices = {
  agentEngine: AgentEnginePort;
  runtimeCatalogOperations: RuntimeCatalogOperations;
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
};

export const createAgentRuntimeServices = (): AgentRuntimeServices => {
  const opencodeAdapter = createOpenCodeRuntimeAdapter();
  const codexAdapter = createCodexAppServerRuntimeAdapter();
  const adapters = new Map<RuntimeKind, AgentRuntimeAdapter>([
    ["opencode", opencodeAdapter],
    ["codex", codexAdapter],
  ]);
  const runtimeKinds = Array.from(adapters.keys());

  const getAdapter = (runtimeKind: RuntimeKind): AgentRuntimeAdapter => {
    const adapter = adapters.get(runtimeKind);
    if (!adapter) {
      throw new Error(`Unsupported agent runtime '${runtimeKind}'.`);
    }
    return adapter;
  };

  for (const runtimeKind of runtimeKinds) {
    const definition = getAdapter(runtimeKind).getRuntimeDefinition();
    const validationErrors = validateRuntimeDefinitionForOpenDucktor(definition);
    if (validationErrors.length > 0) {
      throw new Error(
        `Runtime '${definition.kind}' is incompatible with OpenDucktor: ${validationErrors.join("; ")}`,
      );
    }
  }

  return {
    agentEngine: createAgentEngine(getAdapter, runtimeKinds),
    runtimeCatalogOperations: createHostRuntimeCatalogOperations(getAdapter),
    startRepoRuntime: (repoPath, runtimeKind) => host.runtimeEnsure(repoPath, runtimeKind),
  };
};

const createAgentEngine = (
  getAdapter: (runtimeKind: RuntimeKind) => AgentRuntimeAdapter,
  runtimeKinds: RuntimeKind[],
): AgentEnginePort => {
  return {
    async startSession(input) {
      return getAdapter(input.runtimeKind).startSession(input);
    },
    async resumeSession(input) {
      return getAdapter(input.runtimeKind).resumeSession(input);
    },
    releaseSession: (input) => getAdapter(input.runtimeKind).releaseSession(input),
    async forkSession(input) {
      return getAdapter(input.runtimeKind).forkSession(input);
    },
    listRuntimeDefinitions: () =>
      runtimeKinds.map((runtimeKind) => getAdapter(runtimeKind).getRuntimeDefinition()),
    listAvailableModels: (input) => getAdapter(input.runtimeKind).listAvailableModels(input),
    listAvailableSlashCommands: (input) =>
      getAdapter(input.runtimeKind).listAvailableSlashCommands(input),
    listAvailableSkills: (input) => getAdapter(input.runtimeKind).listAvailableSkills(input),
    searchFiles: (input) => getAdapter(input.runtimeKind).searchFiles(input),
    listSessionRuntimeSnapshots: (input) =>
      getAdapter(input.runtimeKind).listSessionRuntimeSnapshots(input),
    readSessionRuntimeSnapshot: (input) =>
      getAdapter(input.runtimeKind).readSessionRuntimeSnapshot(input),
    loadSessionHistory: (input) => getAdapter(input.runtimeKind).loadSessionHistory(input),
    loadSessionTodos: (input) => getAdapter(input.runtimeKind).loadSessionTodos(input),
    updateSessionModel: (input) => getAdapter(input.runtimeKind).updateSessionModel(input),
    sendUserMessage: (input) => getAdapter(input.runtimeKind).sendUserMessage(input),
    replyApproval: (input) => getAdapter(input.runtimeKind).replyApproval(input),
    replyQuestion: (input) => getAdapter(input.runtimeKind).replyQuestion(input),
    subscribeEvents: (input, listener) =>
      getAdapter(input.runtimeKind).subscribeEvents(input, listener),
    stopSession: (input) => getAdapter(input.runtimeKind).stopSession(input),
    loadSessionDiff: (input) => getAdapter(input.runtimeKind).loadSessionDiff(input),
    loadFileStatus: (input) => getAdapter(input.runtimeKind).loadFileStatus(input),
  };
};
