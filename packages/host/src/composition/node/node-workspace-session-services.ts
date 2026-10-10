import { Effect } from "effect";
import { createWorkspaceSessionImportService } from "../../application/workspaces/workspace-session-import-service";
import { createWorkspaceSessionService } from "../../application/workspaces/workspace-session-service";
import { createWorkspaceSessionLaunchService } from "../../application/workspaces/workspace-session-launch-service";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import { createWorkspaceSessionImportCommandHandlers } from "../../interface/commands/workspace-session-import-command-handlers";
import { createWorkspaceSessionLaunchCommandHandlers } from "../../interface/commands/workspace-session-launch-command-handlers";

type Input = Parameters<typeof createWorkspaceSessionService>[0] &
  Parameters<typeof createWorkspaceSessionImportService>[0] & {
    live: Parameters<typeof createWorkspaceSessionLaunchService>[0]["live"];
    eventBus: CreateNodeHostCommandRouterInput["eventBus"];
    commands: Parameters<typeof createWorkspaceSessionLaunchService>[0]["commands"];
    resolveParts: Parameters<typeof createWorkspaceSessionLaunchService>[0]["resolveParts"];
  };

export const createNodeWorkspaceSessionServices = ({
  eventBus,
  commands,
  ...dependencies
}: Input) => {
  const workspaceSessionService = createWorkspaceSessionService(dependencies);
  const workspaceSessionImports = createWorkspaceSessionImportService(dependencies);
  const workspaceSessionLaunchService = createWorkspaceSessionLaunchService({
    ...dependencies,
    commands,
  });
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
  return {
    handlers: {
      ...createWorkspaceSessionCommandHandlers(
        workspaceSessionService,
        dependencies.publishUpdated,
      ),
      ...createWorkspaceSessionImportCommandHandlers(workspaceSessionImports),
      ...createWorkspaceSessionLaunchCommandHandlers(workspaceSessionLaunchService),
    },
    workspaceSessionService,
    workspaceSessionImports,
    workspaceSessionLaunchService,
    unsubscribeImportCatalogs,
  };
};
