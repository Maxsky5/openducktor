import {
  ODT_TOOL_SCHEMAS,
  type OdtToolName,
  type CompiledWorkflowDefinition,
} from "@openducktor/contracts";
import { z } from "zod";
import { taskIssueTypes } from "./task-workflow/task-input";

const workflowValues = (definition: CompiledWorkflowDefinition, field: string) => {
  if (field === "issueType") return taskIssueTypes(definition);
  if (field === "status") {
    return definition.states.filter(({ terminal }) => !terminal).map(({ id }) => id);
  }
  return [];
};

/**
 * The input schema of an ODT tool, with the issue types and the active states of the workflow as
 * values. Agents read it as a hint. The host checks the values against the workflow of the task.
 */
export const workflowToolInputSchema = (
  definition: CompiledWorkflowDefinition,
  toolName: OdtToolName,
): z.ZodType => {
  const schema = ODT_TOOL_SCHEMAS[toolName];
  const workflowFields = Object.fromEntries(
    Object.entries(schema.shape).flatMap(([field, current]) => {
      const values = workflowValues(definition, field);
      if (values.length === 0) return [];
      const literal = z.literal(values);
      return [[field, current.safeParse(undefined).success ? literal.optional() : literal]];
    }),
  );
  return schema.safeExtend(workflowFields);
};
