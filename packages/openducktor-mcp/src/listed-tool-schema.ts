import { z } from "zod";
import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
} from "./lib";
import type { JsonValue } from "@openducktor/contracts";

export type RegisteredToolName = keyof typeof ODT_TOOL_SCHEMAS;

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);

const removeWorkspaceId = (jsonSchema: Record<string, JsonValue>) => {
  // SAFETY: The surrounding boundary constructs or validates every member required by `Record< string, JsonValue >`.
  const { workspaceId: _workspaceId, ...properties } = jsonSchema.properties as Record<
    string,
    JsonValue
  >;

  return {
    ...jsonSchema,
    properties,
    ...(Array.isArray(jsonSchema.required)
      ? { required: jsonSchema.required.filter((key) => key !== "workspaceId") }
      : undefined),
  } satisfies Record<string, JsonValue>;
};

export const getListedToolInputSchema = (
  toolName: RegisteredToolName,
  options: { hideWorkspaceId: boolean },
): Record<string, JsonValue> => {
  // SAFETY: zod JSON schema output is JSON-compatible by construction.
  const jsonSchema = z.toJSONSchema(ODT_TOOL_SCHEMAS[toolName], {
    io: "input",
  }) as Record<string, JsonValue>;

  if (options.hideWorkspaceId && WORKSPACE_SCOPED_TOOL_NAMES.has(toolName)) {
    return removeWorkspaceId(jsonSchema);
  }

  return jsonSchema;
};

export const getListedToolOutputSchema = (
  toolName: RegisteredToolName,
): Record<string, JsonValue> => {
  // SAFETY: zod JSON schema output is JSON-compatible by construction.
  return z.toJSONSchema(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[toolName], {
    io: "output",
  }) as Record<string, JsonValue>;
};
