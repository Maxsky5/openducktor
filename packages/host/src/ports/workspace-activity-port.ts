import type { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

export type WorkspaceActivityBlocker = {
  kind: "agent-session" | "dev-server" | "terminal";
  label: string;
};

export type WorkspaceActivityPort = {
  inspect(repoPath: string): Effect.Effect<WorkspaceActivityBlocker[], HostOperationErrorAggregate>;
  releaseWorkspaceSessions(repoPath: string): Effect.Effect<void, HostOperationErrorAggregate>;
  releaseWorkspaceRuntimes(repoPath: string): Effect.Effect<void, HostOperationErrorAggregate>;
};
