import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import type { ClaudeWorkspaceWorkingDirectoryDependencies } from "../../application/runtimes/claude-workspace-runtime";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import type { ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import type { ClaudeAgentSdkEventHub } from "./claude-live-session-event-hub";

export type ClaudeRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "claude";
  readonly runtimeRoute: { readonly type: "host_service"; readonly identity: string };
};

export type PreparedClaudeLiveSessionAdapter = Omit<
  PreparedRuntimeLiveSessionAdapter,
  "adapter"
> & {
  readonly adapter: AgentSessionRuntimeAdapterPort;
};

export type ClaudeLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedRuntimeLiveSessionAdapter, HostError>;

export type ClaudeRuntimeSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedClaudeLiveSessionAdapter, HostError>;

export type CreateClaudeLiveSessionAdapterPreparerInput = {
  readonly eventHub: ClaudeAgentSdkEventHub;
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation">;
  readonly service: Pick<
    ClaudeAgentSdkService,
    | "forkSession"
    | "loadSessionContextUsage"
    | "prepareApprovalReply"
    | "prepareQuestionReply"
    | "releaseSession"
    | "resumeSession"
    | "sendUserMessage"
    | "startSession"
    | "stopSession"
    | "stopSessionsForRuntime"
    | "updateSessionModel"
  >;
  readonly sessionStore: {
    get(externalSessionId: string): ClaudeSessionContext | undefined;
  };
  readonly workingDirectoryDependencies: ClaudeWorkspaceWorkingDirectoryDependencies;
};
