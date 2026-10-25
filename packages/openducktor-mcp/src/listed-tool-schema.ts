import { builtinWorkflow, workflowToolInputSchema } from "@openducktor/workflows";
import { z } from "zod";
import { type ODT_TOOL_SCHEMAS, ODT_WORKSPACE_SCOPED_TOOL_NAMES } from "./lib";

const listedToolObjectSchema = z.record(z.string(), z.json());

export type RegisteredToolName = keyof typeof ODT_TOOL_SCHEMAS;
type ListedToolSchema = z.infer<typeof listedToolSchemaSchema>;

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);
const listedToolSchemaSchema = z.intersection(
  listedToolObjectSchema,
  z.object({
    properties: listedToolObjectSchema.optional(),
    required: z.array(z.string()).optional(),
  }),
);

const removeWorkspaceId = (jsonSchema: ListedToolSchema): ListedToolSchema => {
  const { workspaceId: _workspaceId, ...properties } = jsonSchema.properties ?? {};

  const nextSchema = {
    ...jsonSchema,
    properties,
  };
  if (Array.isArray(jsonSchema.required)) {
    nextSchema.required = jsonSchema.required.filter((key) => key !== "workspaceId");
  }
  return listedToolSchemaSchema.parse(nextSchema);
};

const jsonObjectSchema = z.record(z.string(), z.json());
type JsonObject = z.infer<typeof jsonObjectSchema>;
type JsonValue = JsonObject[string];

/** Keys that cost model tokens and guide no call. The server still validates input with them. */
const DROPPED_SCHEMA_KEYS = new Set(["$schema", "maxLength", "maxItems"]);
/** Keys whose value is one schema or a list of schemas. */
const NESTED_SCHEMA_KEYS = new Set(["items", "anyOf", "oneOf", "additionalProperties"]);

const compactSchemaValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(compactSchemaValue);
  const schema = jsonObjectSchema.safeParse(value);
  return schema.success ? compactListedSchema(schema.data) : value;
};

/**
 * Drops the parts of a listed schema that cost model tokens and guide no call: the `$schema` URL,
 * the pattern of a UUID format, and size limits. Codex shows input and output schemas to the
 * model.
 */
const compactListedSchema = (schema: JsonObject): JsonObject => {
  const compact: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    const dropped =
      DROPPED_SCHEMA_KEYS.has(key) ||
      (key === "pattern" && schema.format === "uuid") ||
      (key === "maximum" && value === Number.MAX_SAFE_INTEGER);
    if (dropped) continue;
    if (key === "properties") {
      const properties = jsonObjectSchema.parse(value);
      compact[key] = Object.fromEntries(
        Object.entries(properties).map(([name, property]) => [name, compactSchemaValue(property)]),
      );
    } else {
      compact[key] = NESTED_SCHEMA_KEYS.has(key) ? compactSchemaValue(value) : value;
    }
  }
  return compact;
};

/**
 * The listed input schema of a tool. It names the issue types and active states of the built-in
 * task workflow as a hint. The server validates input with the generic schema, and the host
 * checks the values against the task workflow.
 */
export const getListedToolInputSchema = (
  toolName: RegisteredToolName,
  options: { hideWorkspaceId: boolean },
): ListedToolSchema => {
  const jsonSchema = listedToolSchemaSchema.parse(
    compactListedSchema(
      jsonObjectSchema.parse(
        z.toJSONSchema(workflowToolInputSchema(builtinWorkflow.definition, toolName), {
          io: "input",
        }),
      ),
    ),
  );

  if (options.hideWorkspaceId && WORKSPACE_SCOPED_TOOL_NAMES.has(toolName)) {
    return removeWorkspaceId(jsonSchema);
  }

  return jsonSchema;
};

export const getListedToolOutputSchema = (outputSchema: z.ZodType): ListedToolSchema =>
  listedToolSchemaSchema.parse(
    compactListedSchema(
      jsonObjectSchema.parse(
        z.toJSONSchema(outputSchema, {
          io: "output",
        }),
      ),
    ),
  );
