import { z } from "zod";
import { ODT_TOOL_SCHEMAS, ODT_WORKSPACE_SCOPED_TOOL_NAMES } from "./lib";

export type RegisteredToolName = keyof typeof ODT_TOOL_SCHEMAS;

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);

const removeWorkspaceId = (jsonSchema: Record<string, unknown>): Record<string, unknown> => {
  const { workspaceId: _workspaceId, ...properties } = jsonSchema.properties as Record<
    string,
    unknown
  >;
  return { ...jsonSchema, properties };
};

export const getListedToolInputSchema = (
  toolName: RegisteredToolName,
  options: { hideWorkspaceId: boolean },
): Record<string, unknown> => {
  const jsonSchema = z.toJSONSchema(ODT_TOOL_SCHEMAS[toolName], { io: "input" });

  if (options.hideWorkspaceId && WORKSPACE_SCOPED_TOOL_NAMES.has(toolName)) {
    return removeWorkspaceId(jsonSchema);
  }

  return jsonSchema;
};
