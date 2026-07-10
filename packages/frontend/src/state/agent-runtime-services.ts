import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEnginePort,
  AgentSessionSummary,
} from "@openducktor/core";
import { validateRuntimeDefinitionForOpenDucktor } from "@/lib/agent-runtime";
import { host } from "./operations/shared/host";
import {
  createHostRuntimeCatalogOperations,
  type RuntimeCatalogOperations,
} from "./operations/shared/runtime-catalog";
import type { AgentRuntimeAdapter } from "./runtime-adapters/agent-runtime-adapter";
import { createClaudeRuntimeAdapter } from "./runtime-adapters/claude-runtime-adapter";
import { createCodexAppServerRuntimeAdapter } from "./runtime-adapters/codex-app-server-runtime-adapter";
import { createOpenCodeRuntimeAdapter } from "./runtime-adapters/opencode-runtime-adapter";

type AgentRuntimeServices = {
  agentEngine: AgentEnginePort;
  runtimeCatalogOperations: RuntimeCatalogOperations;
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
};

const toAgentSessionSummary = (
  summary: Awaited<ReturnType<typeof host.agentSessionControlStart>>,
): AgentSessionSummary => ({
  externalSessionId: summary.externalSessionId,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  role: summary.role,
  startedAt: summary.startedAt,
  status: summary.status,
  ...(summary.title !== undefined ? { title: summary.title } : {}),
});

const toAcceptedAgentUserMessage = (
  event: Awaited<ReturnType<typeof host.agentSessionControlSend>>,
): AcceptedAgentUserMessage => {
  const { model, sessionRef, ...message } = event;
  return {
    ...message,
    ...(sessionRef ? { sessionRef } : {}),
    ...(model
      ? {
          model: {
            providerId: model.providerId,
            modelId: model.modelId,
            ...(model.runtimeKind !== undefined ? { runtimeKind: model.runtimeKind } : {}),
            ...(model.variant !== undefined ? { variant: model.variant } : {}),
            ...(model.profileId !== undefined ? { profileId: model.profileId } : {}),
          },
        }
      : {}),
  } as AcceptedAgentUserMessage;
};

export const createAgentRuntimeServices = (): AgentRuntimeServices => {
  const opencodeAdapter = createOpenCodeRuntimeAdapter();
  const codexAdapter = createCodexAppServerRuntimeAdapter();
  const claudeAdapter = createClaudeRuntimeAdapter();
  const adapters = new Map<RuntimeKind, AgentRuntimeAdapter>([
    ["opencode", opencodeAdapter],
    ["codex", codexAdapter],
    ["claude", claudeAdapter],
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
    startSession: async (input) =>
      toAgentSessionSummary(await host.agentSessionControlStart(input)),
    resumeSession: (input) => host.agentSessionControlResume(input).then(toAgentSessionSummary),
    releaseSession: (input) => host.agentSessionControlRelease(input),
    forkSession: (input) => host.agentSessionControlFork(input).then(toAgentSessionSummary),
    listRuntimeDefinitions: () =>
      runtimeKinds.map((runtimeKind) => getAdapter(runtimeKind).getRuntimeDefinition()),
    listAvailableModels: (input) => getAdapter(input.runtimeKind).listAvailableModels(input),
    listAvailableSlashCommands: (input) =>
      getAdapter(input.runtimeKind).listAvailableSlashCommands(input),
    listAvailableSkills: (input) => getAdapter(input.runtimeKind).listAvailableSkills(input),
    listAvailableSubagents: (input) => getAdapter(input.runtimeKind).listAvailableSubagents(input),
    searchFiles: (input) => getAdapter(input.runtimeKind).searchFiles(input),
    loadSessionHistory: (input) => getAdapter(input.runtimeKind).loadSessionHistory(input),
    loadSessionTodos: (input) => getAdapter(input.runtimeKind).loadSessionTodos(input),
    updateSessionModel: (input) => host.agentSessionControlUpdateModel(input),
    sendUserMessage: (input) =>
      host.agentSessionControlSend(input).then(toAcceptedAgentUserMessage),
    stopSession: (input) => host.agentSessionControlStop(input),
    loadSessionDiff: (input) => getAdapter(input.runtimeKind).loadSessionDiff(input),
    loadFileStatus: (input) => getAdapter(input.runtimeKind).loadFileStatus(input),
  };
};
