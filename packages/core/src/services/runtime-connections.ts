import type { AgentRuntimeConnection } from "../types/agent-orchestrator";

export const requireRuntimeConnection = (
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): AgentRuntimeConnection => {
  if (!runtimeConnection) {
    throw new Error(`Runtime connection is required to ${action}.`);
  }

  return runtimeConnection;
};

export const requireRuntimeEndpoint = (
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): string => {
  const connection = requireRuntimeConnection(runtimeConnection, action);
  const endpoint = connection.endpoint?.trim() ?? "";
  if (endpoint.length === 0) {
    throw new Error(`Runtime connection endpoint is required to ${action}.`);
  }

  return endpoint;
};

export const requireRuntimeWorkingDirectory = (
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): string => {
  const connection = requireRuntimeConnection(runtimeConnection, action);
  const workingDirectory = connection.workingDirectory.trim();
  if (workingDirectory.length === 0) {
    throw new Error(`Runtime connection workingDirectory is required to ${action}.`);
  }

  return workingDirectory;
};

export const toRuntimeClientInput = (
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): { runtimeEndpoint: string; workingDirectory: string } => ({
  runtimeEndpoint: requireRuntimeEndpoint(runtimeConnection, action),
  workingDirectory: requireRuntimeWorkingDirectory(runtimeConnection, action),
});
