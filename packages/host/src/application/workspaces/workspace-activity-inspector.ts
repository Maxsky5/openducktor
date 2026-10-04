import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { DevServerService } from "../dev-servers/dev-server-service-types";
import type { TerminalService } from "../terminals/terminal-service";

export type WorkspaceActivityBlocker = {
  kind: "agent-session" | "dev-server" | "terminal";
  label: string;
};

export type WorkspaceActivityPort = {
  inspect(paths: {
    configuredRepoPath: string;
    lifecycleRepoPath: string;
  }): Effect.Effect<WorkspaceActivityBlocker[], HostOperationErrorAggregate>;
  releaseSessions(repoPath: string): Effect.Effect<void, HostOperationErrorAggregate>;
};

const toHostOperationError = (operation: string, message: string, cause: unknown) =>
  new HostOperationError({
    operation,
    message,
    cause: cause instanceof Error ? cause : new Error(String(cause)),
  });

export const createWorkspaceActivityInspector = ({
  agentSessionLiveStateService,
  devServerService,
  terminalService,
}: {
  agentSessionLiveStateService: Pick<AgentSessionLiveStateService, "list" | "releaseSession">;
  devServerService: Pick<DevServerService, "inspectWorkspaceActivity">;
  terminalService: Pick<TerminalService, "inspectWorkspaceActivity">;
}): WorkspaceActivityPort => ({
  inspect: ({ configuredRepoPath, lifecycleRepoPath: repoPath }) =>
    Effect.gen(function* () {
      const blockers: WorkspaceActivityBlocker[] = [];
      const sessions = yield* agentSessionLiveStateService
        .list({ repoPath })
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.inspectAgentSessions",
              `Failed to inspect agent sessions for ${repoPath}. Stop the running work and retry.`,
              cause,
            ),
          ),
        );
      for (const session of sessions) {
        if (session.activity !== "idle") {
          blockers.push({
            kind: "agent-session",
            label: `agent session ${session.ref.externalSessionId} is ${session.activity}`,
          });
        }
      }

      const devServerActivity = yield* devServerService
        .inspectWorkspaceActivity({ repoPath: configuredRepoPath })
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.inspectDevServers",
              `Failed to inspect dev servers for ${configuredRepoPath}. Stop the running work and retry.`,
              cause,
            ),
          ),
        );
      for (const owner of devServerActivity.activeOwners) {
        blockers.push({
          kind: "dev-server",
          label: `dev server for ${owner.kind === "task" ? `task ${owner.taskId}` : `Workspace Session ${owner.sessionId}`} is active; stop its servers first`,
        });
      }

      const terminalActivity = yield* terminalService
        .inspectWorkspaceActivity(repoPath)
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.inspectTerminals",
              `Failed to inspect terminals for ${repoPath}. Close the affected terminals and retry.`,
              cause,
            ),
          ),
        );
      for (const terminalId of terminalActivity.activeTerminalIds) {
        blockers.push({
          kind: "terminal",
          label: `terminal ${terminalId} is running a command`,
        });
      }
      for (const terminalId of terminalActivity.unknownTerminalIds) {
        blockers.push({
          kind: "terminal",
          label: `terminal ${terminalId} activity cannot be verified`,
        });
      }

      return blockers;
    }),
  releaseSessions: (repoPath) =>
    Effect.gen(function* () {
      const sessions = yield* agentSessionLiveStateService
        .list({ repoPath })
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.releaseAgentSessions",
              `Failed to list agent sessions before removing ${repoPath}. Retry removal.`,
              cause,
            ),
          ),
        );
      yield* Effect.forEach(
        sessions,
        (session) =>
          agentSessionLiveStateService
            .releaseSession(session.ref)
            .pipe(
              Effect.mapError((cause) =>
                toHostOperationError(
                  "workspace.releaseAgentSessions",
                  `Failed to release agent session ${session.ref.externalSessionId} before removing ${repoPath}. Retry removal.`,
                  cause,
                ),
              ),
            ),
        { discard: true },
      );
    }),
});
