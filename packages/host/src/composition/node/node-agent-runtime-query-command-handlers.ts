import { createAgentRuntimeQueryService } from "../../application/runtimes/agent-runtime-query-service";
import { createAgentRuntimeQueryCommandHandlers } from "../../interface/commands/agent-runtime-query-command-handlers";

type Dependencies = Parameters<typeof createAgentRuntimeQueryService>[0];
export const createNodeAgentRuntimeQueryCommandHandlers = (
  dependencies: Dependencies,
  preview: Parameters<typeof createAgentRuntimeQueryCommandHandlers>[1],
) => createAgentRuntimeQueryCommandHandlers(createAgentRuntimeQueryService(dependencies), preview);
