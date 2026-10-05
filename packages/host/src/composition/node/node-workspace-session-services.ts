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
  // A runtime replacement or loss invalidates discovery bound to the old generation.
  const unsubscribeImportCatalogs = eventBus?.subscribe(
    "openducktor://runtime-changed",
    (envelope) => {
      if (envelope.channel !== "openducktor://runtime-changed") return;
      if (envelope.payload.type !== "runtime_changed") return;
      const { status } = envelope.payload;
      Effect.runFork(
        workspaceSessionImports.releaseRuntime(
          status.kind,
          status.state === "ready" ? status.runtimeId : null,
        ),
      );
    },
  );
  return { workspaceSessionService, workspaceSessionImports, unsubscribeImportCatalogs };
};
