import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import type { CodexSessionHistoryPort } from "../../ports/codex-session-history-port";
import type { CodexDirectoryMatcher } from "../codex/codex-directory-identity";
import type {
  CodexAppServerAdapter,
  CodexAppServerAdapterOptions,
  CodexImageGenerationPreparer,
} from "@openducktor/adapters-codex-app-server";
import type {
  AgentSessionScope,
  CodexEffectivePolicy,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError, HostOperationErrorAggregate } from "../../effect/host-errors";
import type { OpenDucktorMcpServerConfigResolver } from "../mcp/openducktor-mcp-server-config";
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
  | "listSessionMetadataPage"
  | "openExistingSession"
  | "resolveSessionParent"
  | "loadRuntimeCatalog"
  | "searchFiles"
  | "loadSessionHistory"
  | "loadSessionTodos"
  | "loadFileStatus"
  | "resolveGeneratedImageSource"
  | "beginGeneratedImageBatch"
  | "releaseGeneratedImageBatch"
  | "describeGeneratedImages"
  | "settleGeneratedImages"
  | "prepareRuntime"
  | "listLiveSessionSnapshots"
  | "loadLiveSessionContextUsage"
  | "loadSessionContextUsage"
  | "loadSessionDiff"
  | "replyLiveApproval"
  | "resolvePendingApproval"
  | "replyLiveQuestion"
  | "replyQuestion"
  | "releaseRuntime"
  | "startSession"
  | "resumeSession"
  | "continueInterruptedTurn"
  | "forkSession"
  | "sendUserMessage"
  | "updateSessionModel"
  | "updateSessionTitle"
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
  readonly directoriesMatch: CodexDirectoryMatcher;
  readonly prepareImageGenerations: CodexImageGenerationPreparer;
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "createRuntimeRegistration">;
  readonly codexAppServer: CodexAppServerPort & CodexSessionHistoryPort;
  readonly onBackgroundFailure: (
    failure: HostOperationErrorAggregate,
  ) => Effect.Effect<void, never>;
  /** The Codex policy of a session. A workflow role that writes keeps workspace-write. */
  readonly resolveRuntimePolicy: (input: {
    repoPath: string;
    sessionScope: AgentSessionScope;
  }) => Effect.Effect<CodexEffectivePolicy, HostError>;
  /** The tools and workspace access of a workflow role in the task workflow of the session task. */
  readonly resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  /** Resolves the managed MCP server of the workspace that owns a session repository. */
  readonly resolveMcpServerConfig: OpenDucktorMcpServerConfigResolver;
  readonly createController?: (options: CodexAppServerAdapterOptions) => CodexSessionController;
};
