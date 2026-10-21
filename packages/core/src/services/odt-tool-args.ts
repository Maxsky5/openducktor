import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { z } from "zod";
import type { AgentToolName } from "../types/agent-orchestrator";

export const formatOdtToolArgs = (toolName: AgentToolName): string => {
  // SAFETY: z.toJSONSchema emits an object schema for these strict object input schemas.
  const schema = z.toJSONSchema(ODT_TOOL_SCHEMAS[toolName], { io: "input" }) as JsonSchemaNode;
  // Workflow sessions use the startup workspace and never pass workspaceId.
  return `${toolName}(${formatToolArgFields(schema, toolName, "workspaceId")})`;
};

const formatToolArgFields = (
  schema: JsonSchemaNode,
  context: string,
  omittedField?: string,
): string => {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {})
    .filter(([name]) => name !== omittedField)
    .map(([name, property]) => {
      const type = formatToolArgType(property, `${context}.${name}`);
      return `"${name}"${required.has(name) ? "" : "?"}: ${type}`;
    });
  return `{${fields.join(", ")}}`;
};

const formatToolArgType = (schema: JsonSchemaNode, context: string): string => {
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join("|");
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (union) {
    return union.map((member) => formatToolArgType(member, context)).join("|");
  }
  if (schema.type === "array") {
    return `${formatToolArgType(schema.items ?? {}, `${context}[]`)}[]`;
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
  if (schema.type === "object") {
    return formatToolArgFields(schema, context);
  }
  throw new Error(
    `Unsupported workflow tool argument schema for ${context}: ${JSON.stringify(schema)}`,
  );
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
