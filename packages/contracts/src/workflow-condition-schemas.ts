import { z } from "zod";

export const workflowIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Use a non-blank workflow identifier.");

// Setting record.__proto__ replaces the object prototype instead of adding an entry.
const workflowRecordKeySchema = (kind: string) =>
  workflowIdSchema.refine(
    (value) => value !== "__proto__",
    `${kind} ID "__proto__" is reserved. Use another ${kind.toLowerCase()} ID.`,
  );
const workflowFactIdSchema = workflowRecordKeySchema("Fact");
export const workflowArtifactIdSchema = workflowRecordKeySchema("Artifact");

export const workflowValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type WorkflowValue = z.infer<typeof workflowValueSchema>;

export const workflowFactDefinitionSchema = z.discriminatedUnion("type", [
  z.strictObject({ id: workflowFactIdSchema, type: z.enum(["boolean", "number", "string"]) }),
  z.strictObject({
    id: workflowFactIdSchema,
    type: z.literal("enum"),
    values: z.array(workflowValueSchema).min(1),
  }),
]);
export type WorkflowFactDefinition = z.infer<typeof workflowFactDefinitionSchema>;

export const workflowConditionSchema = z.union([
  z.boolean(),
  z.strictObject({ fact: workflowFactIdSchema, equals: workflowValueSchema }),
  z.strictObject({ stateIn: z.array(workflowIdSchema) }),
  z.strictObject({ artifact: workflowArtifactIdSchema, present: z.boolean() }),
  z.strictObject({ artifact: workflowArtifactIdSchema, verdict: workflowIdSchema }),
  z.strictObject({
    get all(): z.ZodArray<typeof workflowConditionSchema> {
      return z.array(workflowConditionSchema);
    },
  }),
  z.strictObject({
    get any(): z.ZodArray<typeof workflowConditionSchema> {
      return z.array(workflowConditionSchema);
    },
  }),
  z.strictObject({
    get not(): typeof workflowConditionSchema {
      return workflowConditionSchema;
    },
  }),
]);
export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;
