import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRuntimePolicyBinding } from "@openducktor/core";
import { assertAgentRuntimePolicyBinding } from "@openducktor/core";
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
  const validatePolicy = <Input extends AgentRuntimePolicyBinding>(
    input: Input,
    action: string,
  ): Input => {
    assertAgentRuntimePolicyBinding(input, action);
    return input;
  };
  return {
    startSession: (input) =>
      getAdapter(input.runtimeKind).startSession(validatePolicy(input, "start session")),
    resumeSession: (input) =>
      getAdapter(input.runtimeKind).resumeSession(validatePolicy(input, "resume session")),
    releaseSession: (input) => getAdapter(input.runtimeKind).releaseSession(input),
    forkSession: (input) =>
      getAdapter(input.runtimeKind).forkSession(validatePolicy(input, "fork session")),
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
    loadSessionHistory: (input) =>
      getAdapter(input.runtimeKind).loadSessionHistory(
        validatePolicy(input, "load session history"),
      ),
    loadSessionTodos: (input) =>
      getAdapter(input.runtimeKind).loadSessionTodos(validatePolicy(input, "load session todos")),
    updateSessionModel: (input) => getAdapter(input.runtimeKind).updateSessionModel(input),
    sendUserMessage: (input) =>
      getAdapter(input.runtimeKind).sendUserMessage(validatePolicy(input, "send user message")),
    replyApproval: (input) =>
      getAdapter(input.runtimeKind).replyApproval(validatePolicy(input, "reply to approval")),
    replyQuestion: (input) =>
      getAdapter(input.runtimeKind).replyQuestion(validatePolicy(input, "reply to question")),
    subscribeEvents: (input, listener) =>
      getAdapter(input.runtimeKind).subscribeEvents(
        validatePolicy(input, "subscribe to session events"),
        listener,
      ),
    stopSession: (input) => getAdapter(input.runtimeKind).stopSession(input),
    loadSessionDiff: (input) => getAdapter(input.runtimeKind).loadSessionDiff(input),
    loadFileStatus: (input) => getAdapter(input.runtimeKind).loadFileStatus(input),
  };
};
