import { z } from "zod";
import { odtToolWorkspaceIdSchema } from "./odt-tool-workspace-id-schema";
import {
  artifactContentChunkSchema,
  checkArtifactContentChunk,
  artifactReadMetadataSchema,
  artifactDeleteResultSchema,
  freeArtifactContentInputSchema,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  TASK_ARTIFACT_MCP_MAX_READ_BYTES,
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

export const ReadTaskArtifactsInputSchema = taskArtifactScopeInputSchema
  .extend({
    codes: z
      .array(taskArtifactCodeSchema)
      .min(1)
      .refine((codes) => new Set(codes).size === codes.length, "Artifact codes must be distinct.")
      .describe(
        "Workflow and free artifact codes from odt_read_task. Returns content in this order.",
      ),
    byteOffset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Start byte for one selected artifact; default 0. Continue with nextByteOffset and expectedVersion.",
      ),
    maxBytes: z
      .number()
      .int()
      .min(4)
      .max(TASK_ARTIFACT_MCP_MAX_READ_BYTES)
      .optional()
      .describe(
        "Bytes per artifact, from 4 to 1,048,576. Omit for full workflow content or 16 KiB per free artifact. The full response must stay below 10 MiB.",
      ),
    expectedVersion: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "Version returned by the first read. Required when byteOffset is greater than 0. Select exactly one artifact.",
      ),
  })
  .superRefine((input, context) => {
    if (input.codes.length !== 1) {
      for (const field of ["byteOffset", "expectedVersion"] as const) {
        if (input[field] !== undefined) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field} requires exactly one selected artifact.`,
          });
        }
      }
    }
    if (input.byteOffset && input.expectedVersion === undefined) {
      context.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "Continued artifact reads require the expected version from the first read.",
      });
    }
  });
export type ReadTaskArtifactsInput = z.infer<typeof ReadTaskArtifactsInputSchema>;

export const mcpTaskArtifactSchema = z.discriminatedUnion("classification", [
  workflowTaskArtifactSchema.omit({ artifactId: true }),
  freeTaskArtifactSchema.omit({ artifactId: true }),
]);
export type McpTaskArtifact = z.infer<typeof mcpTaskArtifactSchema>;

const mcpArtifactReadMetadataSchema = artifactReadMetadataSchema.extend({
  artifact: mcpTaskArtifactSchema,
});

const mcpArtifactContentChunkSchema = mcpArtifactReadMetadataSchema
  .extend({
    dataBase64: artifactContentChunkSchema.shape.dataBase64,
  })
  .superRefine(checkArtifactContentChunk);

export const readTaskArtifactsResultSchema = z.strictObject({
  artifacts: z.array(mcpArtifactContentChunkSchema),
});
export type ReadTaskArtifactsResult = z.infer<typeof readTaskArtifactsResultSchema>;

export const readTaskArtifactsOutputSchema = z.strictObject({
  artifacts: z.array(
    mcpArtifactReadMetadataSchema.extend({
      content: z
        .string()
        .optional()
        .describe("Decoded UTF-8 text for this artifact, when available."),
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
