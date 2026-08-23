import type { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentEnginePort,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";

const requireOpenCodeRuntime = (runtimeKind: string): void => {
  if (runtimeKind !== "opencode") {
    throw new Error(`OpenCode test adapter received runtime '${runtimeKind}'.`);
  }
};

const openCodeRuntimePolicy = {
  runtimeKind: "opencode",
  runtimePolicy: { kind: "opencode" },
} as const;

const bindStartInput = (
  input: Parameters<AgentEnginePort["startSession"]>[0],
): StartAgentSessionInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt,
    ...(input.model === undefined ? undefined : { model: input.model }),
    ...openCodeRuntimePolicy,
  };
};

const bindResumeInput = (
  input: Parameters<AgentEnginePort["resumeSession"]>[0],
): ResumeAgentSessionInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    sessionScope: input.sessionScope,
    ...(input.model === undefined ? undefined : { model: input.model }),
    ...(input.systemPrompt === undefined ? undefined : { systemPrompt: input.systemPrompt }),
    ...openCodeRuntimePolicy,
  };
};

const bindForkInput = (
  input: Parameters<AgentEnginePort["forkSession"]>[0],
): ForkAgentSessionInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt,
    parentExternalSessionId: input.parentExternalSessionId,
    ...(input.model === undefined ? undefined : { model: input.model }),
    ...(input.runtimeHistoryAnchor === undefined
      ? undefined
      : { runtimeHistoryAnchor: input.runtimeHistoryAnchor }),
    ...openCodeRuntimePolicy,
  };
};

const bindMessagePart = (
  part: Parameters<AgentEnginePort["sendUserMessage"]>[0]["parts"][number],
): SendAgentUserMessageInput["parts"][number] => {
  if (part.kind !== "attachment") {
    return part;
  }
  return {
    kind: "attachment",
    attachment: {
      id: part.attachment.id,
      path: part.attachment.path,
      name: part.attachment.name,
      kind: part.attachment.kind,
      ...(part.attachment.mime === undefined ? undefined : { mime: part.attachment.mime }),
    },
  };
};

const bindSendInput = (
  input: Parameters<AgentEnginePort["sendUserMessage"]>[0],
): SendAgentUserMessageInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    sessionScope: input.sessionScope,
    parts: input.parts.map(bindMessagePart),
    ...(input.model === undefined ? undefined : { model: input.model }),
    ...(input.systemPrompt === undefined ? undefined : { systemPrompt: input.systemPrompt }),
    ...openCodeRuntimePolicy,
  };
};

const validateOpenCodeInput = <Input extends { runtimeKind: string }>(input: Input): Input => {
  requireOpenCodeRuntime(input.runtimeKind);
  return input;
};

const bindPolicyInput = <Input extends { runtimeKind: string }>(input: Input) => {
  requireOpenCodeRuntime(input.runtimeKind);
  return {
    ...input,
    runtimeKind: "opencode",
    runtimePolicy: { kind: "opencode" },
  } as const;
};

export const createOpenCodeAgentEngineTestAdapter = (
  adapter: OpencodeSdkAdapter,
): AgentEnginePort => ({
  listRuntimeDefinitions: () => adapter.listRuntimeDefinitions(),
  listAvailableModels: (input) => adapter.listAvailableModels(validateOpenCodeInput(input)),
  listAvailableSlashCommands: (input) =>
    adapter.listAvailableSlashCommands(validateOpenCodeInput(input)),
  listAvailableSkills: (input) => adapter.listAvailableSkills(validateOpenCodeInput(input)),
  listAvailableSubagents: (input) => adapter.listAvailableSubagents(validateOpenCodeInput(input)),
  searchFiles: (input) => adapter.searchFiles(validateOpenCodeInput(input)),
  startSession: (input) => adapter.startSession(bindStartInput(input)),
  resumeSession: (input) => adapter.resumeSession(bindResumeInput(input)),
  releaseSession: (input) => adapter.releaseSession(input),
  forkSession: (input) => adapter.forkSession(bindForkInput(input)),
  updateSessionModel: (input) => adapter.updateSessionModel(input),
  sendUserMessage: (input) => adapter.sendUserMessage(bindSendInput(input)),
  stopSession: (input) => adapter.stopSession(input),
  loadSessionHistory: (input) => adapter.loadSessionHistory(bindPolicyInput(input)),
  loadSessionTodos: (input) => adapter.loadSessionTodos(bindPolicyInput(input)),
  loadSessionDiff: (input) => adapter.loadSessionDiff(validateOpenCodeInput(input)),
  loadFileStatus: (input) => adapter.loadFileStatus(validateOpenCodeInput(input)),
});
