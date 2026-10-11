import type {
  AgentSessionTranscriptEventType,
  RuntimeOperationFailure,
} from "@openducktor/contracts";
import type { AgentEvent, AgentModelSelection } from "@openducktor/core";
import type { OpencodeRuntimeSnapshotSource } from "./live-session-snapshots";

export type OpencodeSessionContextUsage = {
  readonly totalTokens: number;
  readonly model?: AgentModelSelection;
};
export type OpencodeSessionTranscriptEvent = Extract<
  AgentEvent,
  { type: AgentSessionTranscriptEventType }
>;
export type OpencodeSessionRuntimeSignal =
  | {
      readonly type: "session_event";
      readonly externalSessionId: string;
      readonly event: AgentEvent;
      readonly provenance?: "baseline" | "live";
    }
  | {
      readonly type: "context_updated";
      readonly externalSessionId: string;
      readonly contextUsage: OpencodeSessionContextUsage | null;
    }
  | { readonly type: "session_source"; readonly source: OpencodeRuntimeSnapshotSource }
  | { readonly type: "session_removed"; readonly externalSessionId: string }
  | { readonly type: "observation_reset" }
  | { readonly type: "catalog_invalidated"; readonly workingDirectory?: string }
  | { readonly type: "runtime_notice"; readonly message: string }
  | {
      readonly type: "session_fault";
      readonly externalSessionId: string;
      readonly message: string;
      readonly runtimeOperationFailure?: RuntimeOperationFailure;
      readonly statusUnavailable?: true;
    }
  | {
      readonly type: "fault";
      readonly message: string;
      readonly runtimeOperationFailure?: RuntimeOperationFailure;
    };
