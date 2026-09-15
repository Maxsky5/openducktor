import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { z } from "zod";
import type { AgentToolName } from "../types/agent-orchestrator";

export const formatOdtToolArgs = (toolName: AgentToolName): string => {
  // SAFETY: z.toJSONSchema emits an object schema for these strict object input schemas.
  const schema = z.toJSONSchema(ODT_TOOL_SCHEMAS[toolName], { io: "input" }) as JsonSchemaNode;
  const required = new Set(schema.required ?? []);
  const args = Object.entries(schema.properties ?? {})
    // Workflow sessions use the startup workspace and never pass workspaceId.
    .filter(([name]) => name !== "workspaceId")
    .map(
      ([name, property]) =>
        `"${name}"${required.has(name) ? "" : "?"}: ${formatToolArgType(property)}`,
    );
  return `${toolName}({${args.join(", ")}})`;
};

const formatToolArgType = (schema: JsonSchemaNode): string => {
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join("|");
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (union) {
    return union.map(formatToolArgType).join("|");
  }
  if (schema.type === "array") {
    return `${formatToolArgType(schema.items ?? {})}[]`;
  }
  if (schema.type === "integer" || schema.type === "number") {
    return "number";
  }
  if (schema.type === "boolean") {
    return "boolean";
  }
  if (schema.type === "string") {
    return "string";
  }
  throw new Error(`Unsupported workflow tool argument schema: ${JSON.stringify(schema)}`);
};

type JsonSchemaNode = {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
};
