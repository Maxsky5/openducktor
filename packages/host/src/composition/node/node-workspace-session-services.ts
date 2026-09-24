import { Effect } from "effect";
import { createWorkspaceSessionImportService } from "../../application/workspaces/workspace-session-import-service";
import { createWorkspaceSessionService } from "../../application/workspaces/workspace-session-service";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";

type Input = Parameters<typeof createWorkspaceSessionService>[0] &
  Parameters<typeof createWorkspaceSessionImportService>[0] & {
    eventBus: CreateNodeHostCommandRouterInput["eventBus"];
  };

export const createNodeWorkspaceSessionServices = ({ eventBus, ...dependencies }: Input) => {
  const workspaceSessionService = createWorkspaceSessionService(dependencies);
  const workspaceSessionImports = createWorkspaceSessionImportService(dependencies);
  const unsubscribeImportCatalogs = eventBus?.subscribe(
    "openducktor://agent-session-live-event",
    (envelope) => {
      if (
        envelope.channel === "openducktor://agent-session-live-event" &&
        envelope.payload.type === "runtime_changed" &&
        envelope.payload.state === "stopped"
      ) {
        Effect.runFork(
          workspaceSessionImports.releaseRuntime(
            envelope.payload.scope.repoPath,
            envelope.payload.scope.runtimeKind,
          ),
        );
      }
    },
  );
  return { workspaceSessionService, workspaceSessionImports, unsubscribeImportCatalogs };
};
