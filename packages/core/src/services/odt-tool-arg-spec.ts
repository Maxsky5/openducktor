import { agentToolNameValues, ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { z } from "zod";
import type { AgentToolName } from "../types/agent-orchestrator";

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

const OMITTED_TOOL_ARG_NAMES = new Set(["workspaceId"]);

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

const buildToolArgSpec = (toolName: AgentToolName): string => {
  // SAFETY: z.toJSONSchema emits an object schema for these strict object input schemas.
  const schema = z.toJSONSchema(ODT_TOOL_SCHEMAS[toolName], { io: "input" }) as JsonSchemaNode;
  const required = new Set(schema.required ?? []);
  const args = Object.entries(schema.properties ?? {})
    .filter(([name]) => !OMITTED_TOOL_ARG_NAMES.has(name))
    .map(
      ([name, property]) =>
        `"${name}"${required.has(name) ? "" : "?"}: ${formatToolArgType(property)}`,
    );
  return `${toolName}({${args.join(", ")}})`;
};

const toolArgSpecEntries: [AgentToolName, string][] = agentToolNameValues.map((toolName) => [
  toolName,
  buildToolArgSpec(toolName),
]);

// SAFETY: toolArgSpecEntries holds one entry for every AgentToolName member.
const toolArgSpec = Object.fromEntries(toolArgSpecEntries) as Record<AgentToolName, string>;

export const ODT_TOOL_ARG_SPEC = toolArgSpec;
