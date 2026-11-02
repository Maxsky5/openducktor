import { workspaceRefSchema } from "./workspace-id-schemas";
import { z } from "zod";
import { taskEventCursorSchema } from "./external-task-sync-schemas";
import { workflowArtifactIdSchema, workflowIdSchema } from "./workflow-condition-schemas";

export const TASK_ARTIFACT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** The host rejects a free code that equals a workflow artifact ID. */
export const freeArtifactCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u,
    "Use a lowercase artifact code that starts with a letter and separates words with hyphens.",
  );
/** A workflow artifact ID or a free artifact code. The host checks which one it is. */
export const taskArtifactCodeSchema = z.string().min(1).max(128);

/** The public ID of the workflow artifact with this code. */
export const workflowArtifactId = (taskId: string, code: string): string =>
  `workflow:${taskId}:${code}`;

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
  code: workflowArtifactIdSchema,
  mediaType: z.literal("text/markdown"),
  verdict: workflowIdSchema.optional(),
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
  ...workspaceRefSchema.shape,
  taskId: z.string().min(1).max(256),
});
export type ArtifactScope = z.infer<typeof artifactScopeSchema>;

export const artifactReadRequestSchema = artifactScopeSchema.extend({
  artifactId: taskArtifactIdSchema,
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

export const artifactReadResultSchema = z
  .strictObject({
    artifact: taskArtifactSchema,
    dataBase64: boundedBase64Schema(TASK_ARTIFACT_MAX_FILE_BYTES),
  })
  .superRefine(checkArtifactContent);
export type ArtifactReadResult = z.infer<typeof artifactReadResultSchema>;

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

export function checkArtifactContent(
  result: {
    artifact: { classification: "workflow" } | { classification: "free"; byteSize: number };
    dataBase64: string;
  },
  context: z.RefinementCtx,
): void {
  if (
    result.artifact.classification === "free" &&
    decodedBase64ByteSize(result.dataBase64) !== result.artifact.byteSize
  ) {
    context.addIssue({
      code: "custom",
      path: ["dataBase64"],
      message: "The content size must match the artifact metadata.",
    });
  }
}
