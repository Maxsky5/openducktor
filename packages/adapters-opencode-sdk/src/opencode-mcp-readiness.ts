import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { unwrapData } from "./data-utils";

const OPENDUCKTOR_MCP_SERVER_NAME = "openducktor";
const CONNECTED_MCP_STATUS = "connected";

type OdtStatus = {
  status: string;
  errorDetails: string | undefined;
};

type ReconnectHandler = (event: {
  serverName: string;
  workingDirectory: string;
  status: string;
  errorDetails: string | undefined;
}) => void;

export const ensureTrustedOdtMcpServerConnected = async (input: {
  client: OpencodeClient;
  workingDirectory: string;
  onReconnectStart?: ReconnectHandler | undefined;
}): Promise<void> => {
  const mcp = input.client.mcp;

  const initialStatus = await readOdtStatus({
    mcp,
    workingDirectory: input.workingDirectory,
  });
  const status = initialStatus.status.trim().toLowerCase();
  if (status === CONNECTED_MCP_STATUS) {
    return;
  }

  input.onReconnectStart?.({
    serverName: OPENDUCKTOR_MCP_SERVER_NAME,
    workingDirectory: input.workingDirectory,
    status: initialStatus.status,
    errorDetails: initialStatus.errorDetails,
  });

  const connectResponse = await mcp.connect({
    directory: input.workingDirectory,
    name: OPENDUCKTOR_MCP_SERVER_NAME,
  });
  unwrapData(connectResponse, `connect mcp server ${OPENDUCKTOR_MCP_SERVER_NAME} for role policy`);

  const recoveredStatus = await readOdtStatus({
    mcp,
    workingDirectory: input.workingDirectory,
  });
  if (recoveredStatus.status.trim().toLowerCase() === CONNECTED_MCP_STATUS) {
    return;
  }

  throw new Error(
    unavailableMessage({
      workingDirectory: input.workingDirectory,
      status: initialStatus.status,
      errorDetails: initialStatus.errorDetails,
      recoveredStatus,
    }),
  );
};

const readOdtStatus = async (input: {
  mcp: OpencodeClient["mcp"];
  workingDirectory: string;
}): Promise<OdtStatus> => {
  const response = await input.mcp.status({
    directory: input.workingDirectory,
  });
  const statusPayload = unwrapData(response, "get mcp status for role policy");
  const serverStatus = statusPayload[OPENDUCKTOR_MCP_SERVER_NAME];
  if (!serverStatus) {
    throw new Error(
      `ODT workflow tools unavailable: MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" status is missing.`,
    );
  }

  return {
    status: serverStatus.status,
    errorDetails: "error" in serverStatus ? serverStatus.error : undefined,
  };
};

const unavailableMessage = (input: {
  workingDirectory: string;
  status: string;
  errorDetails: string | undefined;
  recoveredStatus?: OdtStatus;
}): string => {
  const initialStatus = input.status.trim();
  const initialDetails = input.errorDetails ? ` (${input.errorDetails})` : "";
  if (!input.recoveredStatus) {
    return `ODT workflow tools unavailable for "${input.workingDirectory}": MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" is "${initialStatus}"${initialDetails}.`;
  }

  const recoveredDetails = input.recoveredStatus.errorDetails
    ? ` (${input.recoveredStatus.errorDetails})`
    : "";
  return `ODT workflow tools unavailable for "${input.workingDirectory}": MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" stayed unavailable after reconnect. Initial status was "${initialStatus}"${initialDetails}; recovered status is "${input.recoveredStatus.status.trim()}"${recoveredDetails}.`;
};
