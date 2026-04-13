import {
  type AgentRuntimeConnection,
  requireLocalHttpRuntimeConnection,
  requireRuntimeWorkingDirectory,
} from "@openducktor/core";

export type OpencodeRuntimeClientInput = {
  runtimeEndpoint: string;
  workingDirectory: string;
};

export const toOpencodeRuntimeClientInput = (
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): OpencodeRuntimeClientInput => {
  const connection = requireLocalHttpRuntimeConnection(runtimeConnection, action);
  return {
    runtimeEndpoint: connection.endpoint,
    workingDirectory: requireRuntimeWorkingDirectory(connection, action),
  };
};
