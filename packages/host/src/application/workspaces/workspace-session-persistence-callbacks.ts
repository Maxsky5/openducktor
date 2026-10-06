import type {
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";

export type WorkspaceSessionUpdatedPublisher = (
  workspaceId: string,
  session: WorkspaceSession,
) => Effect.Effect<void, HostError>;

export type WorkspaceSessionRuntimeTitleUpdater = (
  input: AgentSessionControlUpdateTitleInput,
) => Effect.Effect<AgentSessionTitleUpdateOutcome, HostError>;

export type WorkspaceSessionRenameFailureReporter = (
  runtimeRef: AgentSessionLiveRef,
  message: string,
  operation?: "workspaceSession.accepted-message.rename" | "workspaceSession.title.sync",
) => Effect.Effect<void>;
