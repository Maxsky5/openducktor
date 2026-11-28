import { z } from "zod";
import { odtToolWorkspaceIdSchema } from "./odt-tool-workspace-id-schema";
import { workspaceRefSchema } from "./workspace-id-schemas";

/** The title of a published preview. */
export const ODT_HTML_PREVIEW_TITLE_MAX_CHARS = 200;

/** The UTF-8 size limit of inline HTML passed directly in tool input. */
export const ODT_HTML_PREVIEW_MAX_BYTES = 512 * 1024;

/** The size limit of each local image file inlined into a published HTML page. */
export const ODT_HTML_PREVIEW_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The maximum UTF-8 byte size of a stored HTML preview after local image inlining. */
export const ODT_HTML_PREVIEW_MAX_STORED_BYTES = 25 * 1024 * 1024;

const textEncoder = new TextEncoder();

export const odtHtmlPreviewByteSize = (html: string): number => textEncoder.encode(html).byteLength;

export const sessionHtmlPreviewIdSchema = z.string().uuid();
export type SessionHtmlPreviewId = z.infer<typeof sessionHtmlPreviewIdSchema>;

const htmlPreviewTitleSchema = z
  .string()
  .trim()
  .min(1, "title must not be blank.")
  .max(
    ODT_HTML_PREVIEW_TITLE_MAX_CHARS,
    `title must be at most ${ODT_HTML_PREVIEW_TITLE_MAX_CHARS} characters.`,
  );

const htmlPreviewPathSchema = z
  .string()
  .trim()
  .min(1, "path must not be blank.")
  .max(4096, "path must be at most 4096 characters.")
  .describe("Absolute .html/.htm path. Relative images resolve from its directory.");

/**
 * Published HTML for the transcript. The host validates, inlines referenced local images, and
 * stores the finished document scoped to the calling session's workspace. Supply either `html` or
 * `path`, not both.
 */
export const OdtPublishHtmlInputSchema = z
  .strictObject({
    workspaceId: odtToolWorkspaceIdSchema.optional(),
    title: htmlPreviewTitleSchema.describe("Short label for full-screen view."),
    html: z
      .string()
      .refine((value) => value.trim().length > 0, "html must not be blank.")
      .refine(
        (value) => odtHtmlPreviewByteSize(value) <= ODT_HTML_PREVIEW_MAX_BYTES,
        `html must be at most ${ODT_HTML_PREVIEW_MAX_BYTES} bytes of UTF-8.`,
      )
      .describe("Inline HTML (512 KiB max). Use absolute image paths or baseDir.")
      .optional(),
    path: htmlPreviewPathSchema.optional(),
    baseDir: z
      .string()
      .trim()
      .min(1, "baseDir must not be blank.")
      .max(4096, "baseDir must be at most 4096 characters.")
      .describe("Absolute directory for relative images in inline html.")
      .optional(),
  })
  .superRefine((input, ctx) => {
    const hasHtml = input.html !== undefined;
    const hasPath = input.path !== undefined;
    if (hasHtml === hasPath) {
      ctx.addIssue({
        code: "custom",
        path: hasHtml ? ["path"] : ["html"],
        message: "Provide exactly one of html or path.",
      });
    }
    if (input.baseDir !== undefined && !hasHtml) {
      ctx.addIssue({
        code: "custom",
        path: ["baseDir"],
        message: "Use baseDir only with inline html.",
      });
    }
  });
export type OdtPublishHtmlInput = z.infer<typeof OdtPublishHtmlInputSchema>;

export const odtPublishHtmlResultSchema = z.strictObject({
  htmlPreview: z.strictObject({
    previewId: sessionHtmlPreviewIdSchema,
    title: htmlPreviewTitleSchema,
    byteSize: z.number().int().positive().max(ODT_HTML_PREVIEW_MAX_STORED_BYTES),
  }),
});
export type OdtPublishHtmlResult = z.infer<typeof odtPublishHtmlResultSchema>;

export const sessionHtmlPreviewReadRequestSchema = workspaceRefSchema
  .extend({
    previewId: sessionHtmlPreviewIdSchema,
  })
  .strict();
export type SessionHtmlPreviewReadRequest = z.infer<typeof sessionHtmlPreviewReadRequestSchema>;

export const sessionHtmlPreviewReadResultSchema = z.strictObject({
  previewId: sessionHtmlPreviewIdSchema,
  html: z.string().min(1),
  byteSize: z.number().int().positive().max(ODT_HTML_PREVIEW_MAX_STORED_BYTES),
});
export type SessionHtmlPreviewReadResult = z.infer<typeof sessionHtmlPreviewReadResultSchema>;
