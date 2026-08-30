import type {
  CodexAppServerAdapter,
  CodexAppServerAdapterOptions,
} from "@openducktor/adapters-codex-app-server";
import type {
  AgentSessionScope,
  CodexEffectivePolicy,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError, HostOperationErrorAggregate } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  CodexAppServerPort,
  CodexAppServerStreamEvent,
} from "../../ports/codex-app-server-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";

export type CodexSessionController = Pick<
  CodexAppServerAdapter,
  | "prepareRuntime"
  | "listLiveSessionSnapshots"
  | "loadLiveSessionContextUsage"
  | "loadSessionContextUsage"
  | "loadSessionDiff"
  | "replyLiveApproval"
  | "replyLiveQuestion"
  | "releaseRuntime"
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "sendUserMessage"
  | "updateSessionModel"
  | "stopSession"
  | "releaseSession"
>;

export type PreparedCodexLiveSessionAdapter = Omit<PreparedRuntimeLiveSessionAdapter, "adapter"> & {
  readonly adapter: AgentSessionRuntimeAdapterPort;
  readonly emitRuntimeEvent: (event: CodexAppServerStreamEvent) => void;
};

export type CodexLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedCodexLiveSessionAdapter, HostError>;

export type CreateCodexLiveSessionAdapterPreparerInput = {
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation">;
  readonly codexAppServer: CodexAppServerPort;
  readonly onBackgroundFailure: (
    failure: HostOperationErrorAggregate,
  ) => Effect.Effect<void, never>;
  readonly resolveRuntimePolicy: (
    scope: AgentSessionScope,
  ) => Effect.Effect<CodexEffectivePolicy, HostError>;
  readonly createController?: (options: CodexAppServerAdapterOptions) => CodexSessionController;
};
