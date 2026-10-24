import { z } from "zod";
import { taskEventCursorSchema } from "./external-task-sync-schemas";
import { qaWorkflowVerdictSchema } from "./task-schemas";

export const TASK_ARTIFACT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TASK_ARTIFACT_MCP_DEFAULT_READ_BYTES = 16 * 1024;
export const TASK_ARTIFACT_MCP_MAX_READ_BYTES = 1024 * 1024;

export const workflowArtifactKindSchema = z.enum(["spec", "plan", "qaReport"]);
export type WorkflowArtifactKind = z.infer<typeof workflowArtifactKindSchema>;

export const freeArtifactCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (code) => !workflowArtifactKindSchema.options.some((kind) => kind === code),
    "The spec, plan, and qaReport codes identify workflow artifacts. Choose another code for a free artifact.",
  )
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u,
    "Use a lowercase artifact code that starts with a letter and separates words with hyphens.",
  );
export const taskArtifactCodeSchema = z.union([workflowArtifactKindSchema, freeArtifactCodeSchema]);

export const workflowArtifactId = (taskId: string, kind: WorkflowArtifactKind): string => {
  const storedKind = { spec: "spec", plan: "implementation_plan", qaReport: "qa_report" }[kind];
  return `workflow:${taskId}:${storedKind}`;
};

export const taskArtifactIdSchema = z.string().min(1).max(512);
export const taskArtifactNameSchema = z.string().trim().min(1).max(255);
export const taskArtifactFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    // Filenames must exclude control characters before they reach a download API.
    // eslint-disable-next-line no-control-regex
    (value) => value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f]/u.test(value),
    "Use a filename without a path or control characters.",
  );
export const taskArtifactMediaTypeSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/u,
    "Use a media type such as text/plain without parameters.",
  );

const artifactBaseFields = {
  artifactId: taskArtifactIdSchema,
  taskId: z.string().min(1).max(256),
  name: taskArtifactNameSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().max(64).nullable(),
};

export const workflowTaskArtifactSchema = z.strictObject({
  ...artifactBaseFields,
  classification: z.literal("workflow"),
  workflowKind: workflowArtifactKindSchema,
  mediaType: z.literal("text/markdown"),
  verdict: qaWorkflowVerdictSchema.optional(),
});
export type WorkflowTaskArtifact = z.infer<typeof workflowTaskArtifactSchema>;

export const freeTaskArtifactSchema = z.strictObject({
  ...artifactBaseFields,
  classification: z.literal("free"),
  code: freeArtifactCodeSchema,
  fileName: taskArtifactFileNameSchema,
  mediaType: taskArtifactMediaTypeSchema,
  byteSize: z.number().int().nonnegative().max(TASK_ARTIFACT_MAX_FILE_BYTES),
});
export type FreeTaskArtifact = z.infer<typeof freeTaskArtifactSchema>;

export const taskArtifactSchema = z.discriminatedUnion("classification", [
  workflowTaskArtifactSchema,
  freeTaskArtifactSchema,
]);
export type TaskArtifact = z.infer<typeof taskArtifactSchema>;

export const taskArtifactCollectionSchema = z.strictObject({
  artifacts: z.array(taskArtifactSchema),
  canManageFree: z.boolean(),
});
export type TaskArtifactCollection = z.infer<typeof taskArtifactCollectionSchema>;

export const artifactScopeSchema = z.strictObject({
  repoPath: z.string().min(1),
  taskId: z.string().min(1).max(256),
});
export type ArtifactScope = z.infer<typeof artifactScopeSchema>;

export const artifactReadRequestSchema = artifactScopeSchema
  .extend({
    artifactId: taskArtifactIdSchema,
    byteOffset: z.number().int().nonnegative().optional(),
    maxBytes: z.number().int().min(4).max(TASK_ARTIFACT_MAX_FILE_BYTES).optional(),
    expectedVersion: z.string().min(1).max(128).optional(),
  })
  .refine((input) => !input.byteOffset || input.expectedVersion !== undefined, {
    path: ["expectedVersion"],
    message: "Continued artifact reads require the expected version from the first read.",
  });
export type ArtifactReadRequest = z.infer<typeof artifactReadRequestSchema>;

const decodedBase64ByteSize = (value: string): number =>
  (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);

const boundedBase64Schema = (maxBytes: number) =>
  z
    .base64()
    .max(Math.ceil(maxBytes / 3) * 4)
    .refine(
      (value) => decodedBase64ByteSize(value) <= maxBytes,
      `Decoded artifact content must be ${maxBytes} bytes or smaller.`,
    );

export const freeArtifactContentInputSchema = z.strictObject({
  fileName: taskArtifactFileNameSchema,
  mediaType: taskArtifactMediaTypeSchema,
  dataBase64: boundedBase64Schema(TASK_ARTIFACT_MAX_FILE_BYTES),
});
export type FreeArtifactContentInput = z.infer<typeof freeArtifactContentInputSchema>;

export const artifactCreateRequestSchema = artifactScopeSchema.extend({
  ...freeArtifactContentInputSchema.shape,
  name: taskArtifactNameSchema,
  code: freeArtifactCodeSchema.optional(),
});
export type ArtifactCreateRequest = z.infer<typeof artifactCreateRequestSchema>;

export const artifactRenameRequestSchema = artifactScopeSchema.extend({
  artifactId: taskArtifactIdSchema,
  name: taskArtifactNameSchema,
});
export type ArtifactRenameRequest = z.infer<typeof artifactRenameRequestSchema>;

export const artifactReplaceRequestSchema = artifactScopeSchema.extend({
  ...freeArtifactContentInputSchema.shape,
  artifactId: taskArtifactIdSchema,
  name: taskArtifactNameSchema.optional(),
});
export type ArtifactReplaceRequest = z.infer<typeof artifactReplaceRequestSchema>;

export const artifactDeleteRequestSchema = artifactScopeSchema.extend({
  artifactId: taskArtifactIdSchema,
});
export type ArtifactDeleteRequest = z.infer<typeof artifactDeleteRequestSchema>;

export const artifactReadMetadataSchema = z.strictObject({
  artifact: taskArtifactSchema,
  version: z.string().min(1).max(128),
  byteOffset: z.number().int().nonnegative(),
  nextByteOffset: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative(),
});
export type ArtifactReadMetadata = z.infer<typeof artifactReadMetadataSchema>;

export const artifactContentChunkSchema = artifactReadMetadataSchema
  .extend({
    dataBase64: boundedBase64Schema(TASK_ARTIFACT_MAX_FILE_BYTES),
  })
  .superRefine(checkArtifactContentChunk);
export type ArtifactContentChunk = z.infer<typeof artifactContentChunkSchema>;

export const artifactSaveResultSchema = z.strictObject({
  artifact: taskArtifactSchema,
  cursor: taskEventCursorSchema,
});
export type ArtifactSaveResult = z.infer<typeof artifactSaveResultSchema>;

export const artifactDeleteResultSchema = z.strictObject({
  artifactId: taskArtifactIdSchema,
  cursor: taskEventCursorSchema,
});
export type ArtifactDeleteResult = z.infer<typeof artifactDeleteResultSchema>;

export function checkArtifactContentChunk(
  chunk: {
    artifact: { classification: "workflow" } | { classification: "free"; byteSize: number };
    byteOffset: number;
    nextByteOffset: number | null;
    totalBytes: number;
    dataBase64: string;
  },
  context: z.RefinementCtx,
): void {
  const end = chunk.byteOffset + decodedBase64ByteSize(chunk.dataBase64);
  if (chunk.artifact.classification === "free" && chunk.totalBytes !== chunk.artifact.byteSize) {
    context.addIssue({
      code: "custom",
      path: ["totalBytes"],
      message: "The total size must match the free artifact metadata.",
    });
  }
  if (end > chunk.totalBytes || chunk.byteOffset > chunk.totalBytes) {
    context.addIssue({
      code: "custom",
      path: ["dataBase64"],
      message: "Artifact content exceeds its total size.",
    });
  }
  if (
    (end < chunk.totalBytes && chunk.nextByteOffset !== end) ||
    (end === chunk.totalBytes && chunk.nextByteOffset !== null) ||
    (end < chunk.totalBytes && end === chunk.byteOffset)
  ) {
    context.addIssue({
      code: "custom",
      path: ["nextByteOffset"],
      message: "The next offset must follow this chunk, or be null at the end.",
    });
  }
}
