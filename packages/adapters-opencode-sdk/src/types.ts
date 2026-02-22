import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentSessionSummary, StartAgentSessionInput } from "@openducktor/core";

export type SessionInput = Omit<StartAgentSessionInput, "sessionId"> & {
  sessionId: string;
};

export type SessionRecord = {
  summary: AgentSessionSummary;
  input: SessionInput;
  client: OpencodeClient;
  externalSessionId: string;
  streamAbortController: AbortController;
  streamDone: Promise<void>;
  emittedAssistantMessageIds: Set<string>;
};

export type ClientFactory = (input: {
  baseUrl: string;
  workingDirectory: string;
}) => OpencodeClient;

export type OpencodeSdkAdapterOptions = {
  now?: () => string;
  createClient?: ClientFactory;
};

export type McpServerStatus = {
  status: string;
  error?: string;
};
