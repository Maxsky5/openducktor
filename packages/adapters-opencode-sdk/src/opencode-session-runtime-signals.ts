import type { AgentSessionGoal, RuntimeOperationFailure } from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentModelSelection,
  AgentSessionBackgroundWork,
} from "@openducktor/core";
import type { OpencodeRuntimeSnapshotSource } from "./live-session-snapshots";

export type OpencodeSessionContextUsage = {
  readonly totalTokens: number;
  readonly model?: AgentModelSelection;
};
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
  | {
      /** The goal plugin changed the goal. `null`: the session has no goal. */
      readonly type: "goal_updated";
      readonly externalSessionId: string;
      readonly goal: AgentSessionGoal | null;
    }
  | ({
      /** The background work of the session tree changed. */
      readonly type: "background_updated";
      readonly externalSessionId: string;
    } & AgentSessionBackgroundWork)
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
      /**
       * The adapter could not read a background task item, so it cannot tell which background
       * tasks the session has. The status stays unavailable until the session or the runtime is
       * released.
       */
      readonly backgroundTrackingLost?: true;
    }
  | {
      readonly type: "fault";
      readonly message: string;
      readonly runtimeOperationFailure?: RuntimeOperationFailure;
    };
