import { z } from "zod";
import { odtToolWorkspaceIdSchema } from "./odt-tool-workspace-id-schema";
import {
  artifactReadResultSchema,
  checkArtifactContent,
  artifactDeleteResultSchema,
  freeArtifactContentInputSchema,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  taskArtifactFileNameSchema,
  taskArtifactMediaTypeSchema,
  taskArtifactNameSchema,
  workflowTaskArtifactSchema,
  freeTaskArtifactSchema,
  freeArtifactCodeSchema,
  taskArtifactCodeSchema,
} from "./task-artifact-schemas";
import { workflowIdSchema } from "./workflow-condition-schemas";

const taskArtifactScopeInputSchema = z.strictObject({
  workspaceId: odtToolWorkspaceIdSchema,
  taskId: z.string().trim().min(1).max(256),
});

export const ReadTaskArtifactsInputSchema = taskArtifactScopeInputSchema.extend({
  codes: z
    .array(taskArtifactCodeSchema)
    .min(1)
    .refine((codes) => new Set(codes).size === codes.length, "Artifact codes must be distinct.")
    .describe(
      "Workflow and free artifact codes from odt_read_task. Returns content in this order.",
    ),
});
export type ReadTaskArtifactsInput = z.infer<typeof ReadTaskArtifactsInputSchema>;

export const mcpTaskArtifactSchema = z.discriminatedUnion("classification", [
  workflowTaskArtifactSchema.omit({ artifactId: true }),
  freeTaskArtifactSchema.omit({ artifactId: true }),
]);
export type McpTaskArtifact = z.infer<typeof mcpTaskArtifactSchema>;

export const readTaskArtifactsResultSchema = z.strictObject({
  artifacts: z.array(
    z
      .strictObject({
        artifact: mcpTaskArtifactSchema,
        dataBase64: artifactReadResultSchema.shape.dataBase64,
      })
      .superRefine(checkArtifactContent),
  ),
});
export type ReadTaskArtifactsResult = z.infer<typeof readTaskArtifactsResultSchema>;

export const readTaskArtifactsOutputSchema = z.strictObject({
  artifacts: z.array(
    z.strictObject({
      artifact: mcpTaskArtifactSchema,
      content: z.string().optional().describe("Complete decoded UTF-8 text, when available."),
    }),
  ),
});
export type ReadTaskArtifactsOutput = z.infer<typeof readTaskArtifactsOutputSchema>;

const artifactTextSchema = z
  .string()
  .max(TASK_ARTIFACT_MAX_FILE_BYTES)
  .refine(
    (value) => !/[\uD800-\uDFFF]/u.test(value),
    "Artifact text must contain valid Unicode characters.",
  )
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= TASK_ARTIFACT_MAX_FILE_BYTES,
    "Artifact text must be 10 MiB or smaller when encoded as UTF-8.",
  );

export const SetTaskArtifactInputSchema = taskArtifactScopeInputSchema
  .extend({
    code: taskArtifactCodeSchema.describe(
      "Artifact to save. Use a workflow artifact code from odt_read_task, or choose a stable lowercase code for a new free artifact.",
    ),
    name: taskArtifactNameSchema
      .optional()
      .describe(
        "Free-artifact display name. Required to create; supply to rename. The code stays the same.",
      ),
    fileName: taskArtifactFileNameSchema
      .optional()
      .describe("Free-artifact filename without a path. Required with free content."),
    mediaType: taskArtifactMediaTypeSchema
      .optional()
      .describe(
        "Free-artifact MIME type without parameters, such as text/html or image/png. Required with free content. Workflow artifacts use text/markdown.",
      ),
    content: artifactTextSchema
      .optional()
      .describe(
        "Complete text to save. Workflow codes require Markdown. Use this or dataBase64 to create or replace content; omit both for a free rename. Limit: 10 MiB.",
      ),
    dataBase64: freeArtifactContentInputSchema.shape.dataBase64
      .optional()
      .describe(
        "Exact file bytes as padded base64. Use instead of content for binary files. Limit: 10 MiB decoded.",
      ),
    verdict: workflowIdSchema
      .optional()
      .describe(
        "Required only for a review artifact. Use one of the verdicts that the workflow declares for it; the role instructions name them. Saves the review and applies its outcome.",
      ),
  })
  .superRefine((input, context) => {
    if (input.content !== undefined && input.dataBase64 !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Supply content for text or dataBase64 for bytes, not both.",
      });
    }
  });
export type SetTaskArtifactInput = z.infer<typeof SetTaskArtifactInputSchema>;

export const DeleteTaskArtifactInputSchema = taskArtifactScopeInputSchema.extend({
  code: freeArtifactCodeSchema.describe(
    "Free-artifact code from odt_read_task. Workflow codes cannot be deleted.",
  ),
});
export type DeleteTaskArtifactInput = z.infer<typeof DeleteTaskArtifactInputSchema>;

export const mcpArtifactSaveResultSchema = z.strictObject({
  artifact: mcpTaskArtifactSchema,
});
export type McpArtifactSaveResult = z.infer<typeof mcpArtifactSaveResultSchema>;

export const mcpArtifactDeleteResultSchema = artifactDeleteResultSchema
  .omit({ artifactId: true })
  .extend({ code: freeArtifactCodeSchema });
export type McpArtifactDeleteResult = z.infer<typeof mcpArtifactDeleteResultSchema>;
