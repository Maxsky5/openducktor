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

export const requireLocalHttpRuntimeConnection = (
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): Extract<AgentRuntimeConnection, { type: "local_http" }> => {
  const connection = requireRuntimeConnection(runtimeConnection, action);
  if (connection.type !== "local_http") {
    throw new Error(
      `Runtime connection type '${connection.type}' is unsupported for ${action}; local_http is required.`,
    );
  }

  const endpoint = connection.endpoint.trim();
  if (endpoint.length === 0) {
    throw new Error(`Runtime connection endpoint is required to ${action}.`);
  }

  return {
    ...connection,
    endpoint,
  };
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
