import { Effect } from "effect";
import { createClaudeSessionMetadataAdapter } from "../../adapters/claude/claude-session-metadata-adapter";
import { createWorkspaceSessionImportService } from "../../application/workspaces/workspace-session-import-service";
import { createWorkspaceSessionService } from "../../application/workspaces/workspace-session-service";
import { createWorkspaceSessionLaunchService } from "../../application/workspaces/workspace-session-launch-service";
import {
  createWorkspaceSessionFileAccess,
  scopeFilesToChats,
} from "../../application/workspaces/workspace-session-file-access";
import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import { createWorkspaceSessionImportCommandHandlers } from "../../interface/commands/workspace-session-import-command-handlers";
import { createWorkspaceSessionLaunchCommandHandlers } from "../../interface/commands/workspace-session-launch-command-handlers";

type Input = Omit<
  Parameters<typeof createWorkspaceSessionService>[0],
  "runForkSourceOperation" | "claudeSessionMetadata" | "live"
> &
  Parameters<typeof createWorkspaceSessionImportService>[0] & {
    live: Omit<
      Parameters<typeof createWorkspaceSessionService>[0]["live"],
      "resumeSession" | "forkSession"
    > &
      Parameters<typeof createWorkspaceSessionLaunchService>[0]["live"];
    eventBus: CreateNodeHostCommandRouterInput["eventBus"];
    commands: Parameters<typeof createWorkspaceSessionLaunchService>[0]["commands"] &
      Pick<
        ReturnType<
          typeof import("../../application/agent-sessions/agent-session-command-service").createAgentSessionCommandService
        >,
        "prepareSessionCreation" | "runForkSourceOperation"
      >;
    resolveParts: Parameters<typeof createWorkspaceSessionLaunchService>[0]["resolveParts"];
    /** The user environment, which also runs Claude. */
    readEnv: () => NodeJS.ProcessEnv;
  };

export const createNodeWorkspaceSessionServices = ({
  eventBus,
  commands,
  readEnv,
  ...dependencies
}: Input) => {
  const workspaceSessionService = createWorkspaceSessionService({
    ...dependencies,
    claudeSessionMetadata: createClaudeSessionMetadataAdapter(readEnv),
    runForkSourceOperation: commands.runForkSourceOperation,
    live: {
      ...dependencies.live,
      resumeSession: commands.resumeSession,
      forkSession: commands.prepareSessionCreation.forkSession,
    },
  });
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
  const fileAccess = createWorkspaceSessionFileAccess(dependencies);
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
    /** Keeps each chat file request in the saved chat directory. */
    scopeFiles: (files: WorkspaceFilesService) => scopeFilesToChats(files, fileAccess),
    unsubscribeImportCatalogs,
  };
};
