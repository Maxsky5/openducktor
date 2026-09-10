import { appQueryClient } from "@/lib/query-client";
import { generatedImageMetadataSessionKey } from "@/state/queries/agent-generated-image-metadata";
import type {
  AgentRepositorySessionStartInput,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { AcceptedAgentUserMessage, AgentEnginePort } from "@openducktor/core";
import { validateRuntimeDefinitionForOpenDucktor } from "@/lib/agent-runtime";
import { host } from "./operations/shared/host";
import {
  createHostRuntimeCatalogOperations,
  type RuntimeCatalogOperations,
} from "./operations/shared/runtime-catalog";

type AgentRuntimeServices = {
  agentEngine: AgentEnginePort;
  runtimeCatalogOperations: RuntimeCatalogOperations;
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
};

const toAcceptedAgentUserMessage = (
  event: Awaited<ReturnType<typeof host.agentSessionControlSend>>,
): AcceptedAgentUserMessage => {
  const { model, sessionRef, ...message } = event;
  const acceptedMessage: AcceptedAgentUserMessage = { ...message };
  if (sessionRef) {
    acceptedMessage.sessionRef = sessionRef;
  }
  if (model) {
    const acceptedModel: NonNullable<AcceptedAgentUserMessage["model"]> = {
      providerId: model.providerId,
      modelId: model.modelId,
    };
    if (model.runtimeKind !== undefined) {
      acceptedModel.runtimeKind = model.runtimeKind;
    }
    if (model.variant !== undefined) {
      acceptedModel.variant = model.variant;
    }
    if (model.profileId !== undefined) {
      acceptedModel.profileId = model.profileId;
    }
    acceptedMessage.model = acceptedModel;
  }
  return acceptedMessage;
};

export const createAgentRuntimeServices = (hostClient: HostClient = host): AgentRuntimeServices => {
  const runtimeDefinitions = Object.values(RUNTIME_DESCRIPTORS_BY_KIND);
  for (const definition of runtimeDefinitions) {
    const validationErrors = validateRuntimeDefinitionForOpenDucktor(definition);
    if (validationErrors.length > 0) {
      throw new Error(
        `Runtime '${definition.kind}' is incompatible with OpenDucktor: ${validationErrors.join("; ")}`,
      );
    }
  }
  return {
    agentEngine: createAgentEngine(hostClient),
    runtimeCatalogOperations: createHostRuntimeCatalogOperations(hostClient),
    startRepoRuntime: (repoPath, runtimeKind) => hostClient.runtimeEnsure(repoPath, runtimeKind),
  };
};

const createAgentEngine = (hostClient: HostClient): AgentEnginePort => {
  return {
    describeGeneratedImages: (input) => hostClient.agentSessionDescribeGeneratedImages(input),
    beginGeneratedImageBatch: (input) => hostClient.agentSessionBeginGeneratedImageBatch(input),
    releaseGeneratedImageBatch: (input) => hostClient.agentSessionReleaseGeneratedImageBatch(input),
    readGeneratedImage: (input) => hostClient.agentSessionReadGeneratedImage(input),
    startSession: (input) => {
      if (input.sessionScope.kind === "workflow") {
        return Promise.reject(
          new Error("Workflow sessions must start through agentSessionWorkflowStart."),
        );
      }
      const startInput: AgentRepositorySessionStartInput = {
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        sessionScope: input.sessionScope,
        systemPrompt: input.systemPrompt,
      };
      if (input.model) {
        startInput.model = input.model;
      }
      return hostClient.agentSessionControlStart(startInput);
    },
    resumeSession: (input) => hostClient.agentSessionControlResume(input),
    releaseSession: (input) => hostClient.agentSessionControlRelease(input),
    forkSession: (input) => hostClient.agentSessionControlFork(input),
    listRuntimeDefinitions: () => Object.values(RUNTIME_DESCRIPTORS_BY_KIND),
    listAvailableModels: (input) => hostClient.agentRuntimeListModels(input),
    listAvailableSlashCommands: (input) => hostClient.agentRuntimeListSlashCommands(input),
    listAvailableSkills: (input) => hostClient.agentRuntimeListSkills(input),
    listAvailableSubagents: (input) => hostClient.agentRuntimeListSubagents(input),
    searchFiles: (input) => hostClient.agentRuntimeSearchFiles(input),
    loadSessionHistory: async (input) => {
      const history = await hostClient.agentRuntimeLoadSessionHistory(input);
      const filters = { queryKey: generatedImageMetadataSessionKey(input) };
      void appQueryClient
        .cancelQueries(filters)
        .then(() => appQueryClient.invalidateQueries(filters));
      return history;
    },
    loadSessionTodos: (input) => hostClient.agentRuntimeLoadSessionTodos(input),
    updateSessionModel: (input) => hostClient.agentSessionControlUpdateModel(input),
    sendUserMessage: (input) =>
      hostClient.agentSessionControlSend(input).then(toAcceptedAgentUserMessage),
    stopSession: (input) => hostClient.agentSessionControlStop(input),
    loadSessionDiff: (input) => hostClient.agentRuntimeLoadSessionDiff(input),
    loadFileStatus: (input) => hostClient.agentRuntimeFileStatus(input),
  };
};
