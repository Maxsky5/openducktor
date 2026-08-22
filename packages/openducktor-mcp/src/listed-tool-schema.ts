import { z } from "zod";
import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
} from "./lib";
import { jsonValueSchema } from "@openducktor/contracts";

export type RegisteredToolName = keyof typeof ODT_TOOL_SCHEMAS;
type ListedToolSchema = z.infer<typeof listedToolSchemaSchema>;

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);
const listedToolSchemaSchema = z.intersection(
  z.record(z.string(), jsonValueSchema),
  z.object({
    properties: z.record(z.string(), jsonValueSchema).optional(),
    required: z.array(z.string()).optional(),
  }),
);

const removeWorkspaceId = (jsonSchema: ListedToolSchema): ListedToolSchema => {
  const { workspaceId: _workspaceId, ...properties } = jsonSchema.properties ?? {};

  const nextSchema = {
    ...jsonSchema,
    properties,
    ...(Array.isArray(jsonSchema.required)
      ? { required: jsonSchema.required.filter((key) => key !== "workspaceId") }
      : undefined),
  };
  return listedToolSchemaSchema.parse(nextSchema);
};

export const getListedToolInputSchema = (
  toolName: RegisteredToolName,
  options: { hideWorkspaceId: boolean },
): ListedToolSchema => {
  const jsonSchema = listedToolSchemaSchema.parse(
    z.toJSONSchema(ODT_TOOL_SCHEMAS[toolName], {
      io: "input",
    }),
  );

  if (options.hideWorkspaceId && WORKSPACE_SCOPED_TOOL_NAMES.has(toolName)) {
    return removeWorkspaceId(jsonSchema);
  }

  return jsonSchema;
};

export const getListedToolOutputSchema = (toolName: RegisteredToolName): ListedToolSchema =>
  listedToolSchemaSchema.parse(
    z.toJSONSchema(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[toolName], {
      io: "output",
    }),
  );
