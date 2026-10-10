import type { RuntimeOperationFailure } from "@openducktor/contracts";
import type { OpencodeSessionContextUsage } from "./opencode-session-runtime-signals";
import type {
  AgentEvent,
  AgentSessionRuntimeSnapshotSource,
  AgentSessionAssociation,
} from "@openducktor/core";

export type OpencodeRuntimeSnapshotSource = AgentSessionRuntimeSnapshotSource & {
  repoPath: string;
  externalSessionId: string;
  workingDirectory: string;
  sessionAssociation: AgentSessionAssociation;
  queuedMessages?: Extract<AgentEvent, { type: "user_message" }>[];
  contextUsage?: OpencodeSessionContextUsage | null;
};
export type OpencodeRuntimeSnapshotFailure = {
  repoPath: string;
  externalSessionId: string;
  workingDirectory: string;
  message: string;
  runtimeOperationFailure?: RuntimeOperationFailure;
};
export type OpencodeRuntimeSnapshotRead = {
  sources: OpencodeRuntimeSnapshotSource[];
  failures: OpencodeRuntimeSnapshotFailure[];
};
