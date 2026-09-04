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
  const boundInput: StartAgentSessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt,
    ...openCodeRuntimePolicy,
  };
  if (input.model !== undefined) {
    boundInput.model = input.model;
  }
  return boundInput;
};

const bindResumeInput = (
  input: Parameters<AgentEnginePort["resumeSession"]>[0],
): ResumeAgentSessionInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  const boundInput: ResumeAgentSessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    sessionScope: input.sessionScope,
    ...openCodeRuntimePolicy,
  };
  if (input.model !== undefined) {
    boundInput.model = input.model;
  }
  if (input.systemPrompt !== undefined) {
    boundInput.systemPrompt = input.systemPrompt;
  }
  return boundInput;
};

const bindForkInput = (
  input: Parameters<AgentEnginePort["forkSession"]>[0],
): ForkAgentSessionInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  const boundInput: ForkAgentSessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt,
    parentExternalSessionId: input.parentExternalSessionId,
    ...openCodeRuntimePolicy,
  };
  if (input.model !== undefined) {
    boundInput.model = input.model;
  }
  if (input.runtimeHistoryAnchor !== undefined) {
    boundInput.runtimeHistoryAnchor = input.runtimeHistoryAnchor;
  }
  return boundInput;
};

const bindMessagePart = (
  part: Parameters<AgentEnginePort["sendUserMessage"]>[0]["parts"][number],
): SendAgentUserMessageInput["parts"][number] => {
  if (part.kind !== "attachment") {
    return part;
  }
  const boundPart: Extract<SendAgentUserMessageInput["parts"][number], { kind: "attachment" }> = {
    kind: "attachment",
    attachment: {
      id: part.attachment.id,
      path: part.attachment.path,
      name: part.attachment.name,
      kind: part.attachment.kind,
    },
  };
  if (part.attachment.mime !== undefined) boundPart.attachment.mime = part.attachment.mime;
  return boundPart;
};

const bindSendInput = (
  input: Parameters<AgentEnginePort["sendUserMessage"]>[0],
): SendAgentUserMessageInput => {
  requireOpenCodeRuntime(input.runtimeKind);
  const boundInput: SendAgentUserMessageInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    sessionScope: input.sessionScope,
    parts: input.parts.map(bindMessagePart),
    ...openCodeRuntimePolicy,
  };
  if (input.model !== undefined) {
    boundInput.model = input.model;
  }
  if (input.systemPrompt !== undefined) {
    boundInput.systemPrompt = input.systemPrompt;
  }
  return boundInput;
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
  updateSessionModel: (input) =>
    adapter.updateSessionModel({
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      workingDirectory: input.workingDirectory,
      externalSessionId: input.externalSessionId,
      model: input.model,
    }),
  sendUserMessage: (input) => adapter.sendUserMessage(bindSendInput(input)),
  stopSession: (input) => adapter.stopSession(input),
  loadSessionHistory: (input) => adapter.loadSessionHistory(bindPolicyInput(input)),
  loadSessionTodos: (input) => adapter.loadSessionTodos(bindPolicyInput(input)),
  loadSessionDiff: (input) => adapter.loadSessionDiff(validateOpenCodeInput(input)),
  loadFileStatus: (input) => adapter.loadFileStatus(validateOpenCodeInput(input)),
});
