import { z } from "zod";
import { workflowIdSchema } from "./workflow-condition-schemas";
export const workflowReferenceSchema = z.strictObject({
  id: workflowIdSchema,
  revision: z.number().int().positive(),
});
export type WorkflowReference = z.infer<typeof workflowReferenceSchema>;
