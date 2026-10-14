import {
  createAgentSessionLiveCommandHandlers,
  createWorkflowLaunchCommandHandlers,
} from "../../interface/commands/agent-session-live-command-handlers";
import { createAgentRuntimeQueryCommandHandlers } from "../../interface/commands/agent-runtime-query-command-handlers";
import { createClaudeToolCatalogService } from "../../application/runtimes/claude-tool-catalog-service";
import { createModelCatalogPreviewComposition as previewModels } from "./model-catalog-preview-composition";
import type { createNodeSessionLaunchControls } from "./node-session-launch-controls";
import type { createNodeMessageDelivery } from "./node-message-delivery";
import type { createNodeTaskSessionServices } from "./node-task-session-services";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";

export const createNodeWorkflowCommandHandlers = ({
  launchControls,
  messageDelivery,
  taskSessions,
  defaultPorts,
  git,
  runtimeDefinitionsService,
  clientVersion,
  runtimeRegistry,
  adapterRegistry,
}: {
  launchControls: ReturnType<
    typeof createNodeSessionLaunchControls<
      ReturnType<typeof createNodeTaskSessionServices>["agentSessionCommandService"]
    >
  >;
  messageDelivery: ReturnType<typeof createNodeMessageDelivery>;
  taskSessions: ReturnType<typeof createNodeTaskSessionServices>;
  defaultPorts: NodeHostDefaultPorts;
  git: Parameters<typeof previewModels>[1];
  runtimeDefinitionsService: Parameters<typeof previewModels>[2];
  clientVersion: Parameters<typeof previewModels>[3];
  runtimeRegistry: Parameters<typeof createClaudeToolCatalogService>[0]["runtimeRegistry"];
  adapterRegistry: Parameters<typeof createClaudeToolCatalogService>[0]["adapterRegistry"];
}) => ({
  ...createAgentSessionLiveCommandHandlers(launchControls.commands, messageDelivery),
  ...createWorkflowLaunchCommandHandlers(taskSessions.workflowLaunchService),
  ...createAgentRuntimeQueryCommandHandlers(
    taskSessions.agentRuntimeQueries,
    previewModels(defaultPorts, git, runtimeDefinitionsService, clientVersion),
    createClaudeToolCatalogService({ runtimeRegistry, adapterRegistry }),
  ),
});
