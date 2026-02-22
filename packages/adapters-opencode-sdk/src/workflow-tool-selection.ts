import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { type AgentRole, buildRoleScopedOdtToolSelection } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { toToolIdList } from "./payload-mappers";

export const resolveWorkflowToolSelection = async (input: {
  client: OpencodeClient;
  role: AgentRole;
  workingDirectory: string;
}): Promise<Record<string, boolean>> => {
  const selectionFromKnownAliases = buildRoleScopedOdtToolSelection(input.role);
  try {
    const response = await input.client.tool.ids({
      directory: input.workingDirectory,
    });
    const runtimeToolIds = toToolIdList(unwrapData(response, "list tool ids for role policy"));
    if (runtimeToolIds.length === 0) {
      return selectionFromKnownAliases;
    }
    return buildRoleScopedOdtToolSelection(input.role, {
      runtimeToolIds,
    });
  } catch {
    return selectionFromKnownAliases;
  }
};
