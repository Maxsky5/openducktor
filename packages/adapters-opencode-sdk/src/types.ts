import type { OpenCodeClient, V2Event } from "@opencode/client";
import type { AgentSessionScope, OpenCodeCreationSettings } from "@openducktor/contracts";

/** Private process connection. Never include authentication in public routes or records. */
export type OpenCodeRuntimeConnection = {
  runtimeId: string;
  endpoint: string;
  authentication: { type: "basic"; username: "opencode"; password: string };
};
export type ClientFactory = (
  connection: OpenCodeRuntimeConnection,
  signal?: AbortSignal,
) => OpenCodeClient;
export type ReadOpencodeDirectory = <Value>(
  directory: string,
  read: () => Promise<Value>,
) => Promise<Value | null>;
export type OpencodeStreamEventLog = {
  externalSessionId: string;
  relevant: boolean;
  event: V2Event;
};
export type OpencodeEventLogger = (entry: OpencodeStreamEventLog) => void;
export type OpencodeSdkAdapterOptions = {
  resolveCreationSettings: (scope: AgentSessionScope) => Promise<OpenCodeCreationSettings>;
  createClient?: ClientFactory;
  logEvent?: OpencodeEventLogger;
};
