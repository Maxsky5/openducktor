import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { AgentStateContextValue } from "@/types/state-slices";

type StartAgentSessionInput = Parameters<AgentStateContextValue["startAgentSession"]>[0];

type SessionStartExecutionRequestBase = {
  taskId: string;
  role: AgentRole;
  kickoffTargetBranch?: GitTargetBranch | null;
};

export type ReuseSessionStartExecutionRequest = SessionStartExecutionRequestBase & {
  startMode: "reuse";
  sourceExternalSessionId: string;
};

export type FreshSessionStartExecutionRequest = SessionStartExecutionRequestBase & {
  startMode: "fresh";
  selectedModel: AgentModelSelection;
  targetWorkingDirectory?: string | null;
};

export type ForkSessionStartExecutionRequest = SessionStartExecutionRequestBase & {
  startMode: "fork";
  selectedModel: AgentModelSelection;
  sourceExternalSessionId: string;
};

export type SessionStartExecutionRequest =
  | ReuseSessionStartExecutionRequest
  | FreshSessionStartExecutionRequest
  | ForkSessionStartExecutionRequest;

export type ExecuteSessionStartArgs = SessionStartExecutionRequest & {
  startAgentSession: AgentStateContextValue["startAgentSession"];
};

const prepareFreshSessionStartInput = ({
  taskId,
  role,
  selectedModel,
  targetWorkingDirectory,
  kickoffTargetBranch,
}: FreshSessionStartExecutionRequest): StartAgentSessionInput => ({
  taskId,
  role,
  selectedModel,
  startMode: "fresh",
  ...(kickoffTargetBranch !== undefined ? { kickoffTargetBranch } : {}),
  ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
});

const prepareReuseSessionStartInput = ({
  taskId,
  role,
  sourceExternalSessionId,
  kickoffTargetBranch,
}: ReuseSessionStartExecutionRequest): StartAgentSessionInput => ({
  taskId,
  role,
  startMode: "reuse",
  sourceExternalSessionId,
  ...(kickoffTargetBranch !== undefined ? { kickoffTargetBranch } : {}),
});

const prepareForkSessionStartInput = ({
  taskId,
  role,
  selectedModel,
  sourceExternalSessionId,
  kickoffTargetBranch,
}: ForkSessionStartExecutionRequest): StartAgentSessionInput => ({
  taskId,
  role,
  selectedModel,
  startMode: "fork",
  sourceExternalSessionId,
  ...(kickoffTargetBranch !== undefined ? { kickoffTargetBranch } : {}),
});

export const prepareSessionStartInput = (
  request: SessionStartExecutionRequest,
): StartAgentSessionInput => {
  switch (request.startMode) {
    case "fresh":
      return prepareFreshSessionStartInput(request);
    case "reuse":
      return prepareReuseSessionStartInput(request);
    case "fork":
      return prepareForkSessionStartInput(request);
  }
};

export const executeSessionStart = async ({
  startAgentSession,
  ...request
}: ExecuteSessionStartArgs): Promise<string> => {
  const input = prepareSessionStartInput(request);
  return startAgentSession(input);
};
