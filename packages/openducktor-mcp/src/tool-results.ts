import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  ReadTaskArtifactsResult,
  ReadTaskArtifactsOutput,
  OdtToolErrorCode,
  OdtToolErrorIssue,
  OdtToolErrorPayload,
} from "@openducktor/contracts";
import {
  odtBrowserToolResultSchema,
  readTaskAssetsResultSchema,
  readTaskArtifactsResultSchema,
  taskAssetMediaTypeSchema,
} from "@openducktor/contracts";
import { z, type JSONType } from "zod";

export type ToolResult = CallToolResult;
export type McpToolPayload = JSONType;

export const mcpToolPayloadSchema = z.json();
const structuredToolPayloadSchema = z.record(z.string(), mcpToolPayloadSchema);

export type OdtToolErrorDetails = NonNullable<OdtToolErrorPayload["error"]["details"]>;

export type OdtToolErrorInput = {
  readonly code: OdtToolErrorCode;
  readonly message: string;
  readonly details?: OdtToolErrorDetails | undefined;
  readonly issues?: OdtToolErrorIssue[] | undefined;
};

export class OdtToolError extends Error {
  readonly code: OdtToolErrorCode;
  readonly details: OdtToolErrorDetails | undefined;
  readonly issues: OdtToolErrorIssue[] | undefined;

  constructor({ code, message, details, issues }: OdtToolErrorInput, options?: ErrorOptions) {
    super(message, options);
    this.name = "OdtToolError";
    this.code = code;
    this.details = details;
    this.issues = issues;
  }
}

type ZodIssueSummary = OdtToolErrorIssue;
const errorTextSchema = z.string();
const errorPrimitiveSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
  z.boolean(),
]);
const issuePathEntrySchema = z.union([z.string(), z.number()]);

export const toErrorMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  const text = errorTextSchema.safeParse(cause);
  if (text.success && text.data.trim().length > 0) {
    return text.data.trim();
  }
  const primitive = errorPrimitiveSchema.safeParse(cause);
  if (primitive.success) {
    return String(primitive.data);
  }
  return "Unknown error";
};

const isStructuredToolPayload = (
  payload: McpToolPayload,
): payload is Record<string, McpToolPayload> =>
  structuredToolPayloadSchema.safeParse(payload).success;

const summarizeIssue = (issue: {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
}): ZodIssueSummary => ({
  path: issue.path.flatMap((entry) => {
    const parsed = issuePathEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }),
  message: issue.message,
  code: issue.code ?? "invalid_input",
});

const normalizeOdtToolErrorIssues = (
  issues: readonly OdtToolErrorIssue[] | undefined,
): ZodIssueSummary[] | undefined => {
  if (!issues || issues.length === 0) {
    return undefined;
  }

  return issues.map(summarizeIssue);
};

const readZodIssues = (cause: unknown): ZodIssueSummary[] | undefined => {
  if (!(cause instanceof z.ZodError)) {
    return undefined;
  }

  return cause.issues.map(summarizeIssue);
};

const readOdtToolErrorIssues = (cause: unknown): ZodIssueSummary[] | undefined => {
  if (!(cause instanceof OdtToolError)) {
    return undefined;
  }

  return normalizeOdtToolErrorIssues(cause.issues);
};

export const toToolResult = (payload: McpToolPayload): ToolResult => {
  const result: ToolResult = {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
  if (isStructuredToolPayload(payload)) {
    result.structuredContent = payload;
  }
  return result;
};

export const toTaskAssetsToolResult = (
  payload: z.input<typeof readTaskAssetsResultSchema>,
): ToolResult => {
  const parsed = readTaskAssetsResultSchema.parse(payload);
  return {
    content: parsed.assets.flatMap((asset) => [
      {
        type: "text" as const,
        text: `Task description asset ${asset.assetId} (${asset.mediaType}, ${asset.byteSize} bytes)`,
      },
      {
        type: "image" as const,
        data: asset.dataBase64,
        mimeType: asset.mediaType,
      },
    ]),
  };
};

const MAX_ARTIFACT_RESPONSE_BYTES = 10 * 1024 * 1024;

export const toTaskArtifactsToolResult = (
  payload: ReadTaskArtifactsResult,
  requestId: string | number = 0,
): ToolResult => {
  const parsed = readTaskArtifactsResultSchema.parse(payload);
  const artifacts = parsed.artifacts.map(toArtifactResult);
  const result = toToolResult(
    mcpToolPayloadSchema.parse({ artifacts: artifacts.map(({ entry }) => entry) }),
  );
  result.content.push(...artifacts.flatMap(({ blocks }) => blocks));
  const serializedBytes =
    Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: requestId, result }), "utf8") + 1;
  if (serializedBytes >= MAX_ARTIFACT_RESPONSE_BYTES) {
    throw new OdtToolError({
      code: "ODT_TOOL_EXECUTION_ERROR",
      message:
        "The artifact response reaches the 10 MiB MCP response limit. Select fewer artifacts or reduce maxBytes.",
    });
  }
  return result;
};

export const toBrowserToolResult = (
  payload: z.input<typeof odtBrowserToolResultSchema>,
): ToolResult => ({
  content: odtBrowserToolResultSchema
    .parse(payload)
    .content.map((block) =>
      block.type === "text"
        ? { type: "text" as const, text: block.text }
        : { type: "image" as const, data: block.dataBase64, mimeType: block.mimeType },
    ),
});

export const toToolError = (cause: unknown): ToolResult => {
  const message = toErrorMessage(cause);
  const zodIssues = readZodIssues(cause);
  const odtIssues = readOdtToolErrorIssues(cause);
  const issues = odtIssues ?? zodIssues;
  const code =
    cause instanceof OdtToolError
      ? cause.code
      : zodIssues
        ? "ODT_TOOL_INPUT_INVALID"
        : "ODT_TOOL_EXECUTION_ERROR";
  const error: OdtToolErrorPayload["error"] = {
    code,
    message,
  };
  if (cause instanceof OdtToolError && cause.details) {
    error.details = cause.details;
  }
  if (issues) {
    error.issues = issues;
  }
  const errorPayload: OdtToolErrorPayload = {
    ok: false,
    error,
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(errorPayload, null, 2),
      },
    ],
    isError: true,
  };
};

type ArtifactResult = {
  entry: ReadTaskArtifactsOutput["artifacts"][number];
  blocks: ToolResult["content"];
};

const toArtifactResult = (
  payload: ReadTaskArtifactsResult["artifacts"][number],
): ArtifactResult => {
  const { dataBase64, ...metadata } = payload;
  const entry: ArtifactResult["entry"] = metadata;
  const length = (metadata.nextByteOffset ?? metadata.totalBytes) - metadata.byteOffset;
  const { artifact } = metadata;
  const uri = `odt-artifact:///tasks/${encodeURIComponent(artifact.taskId)}/artifacts/${artifact.classification}/${encodeURIComponent(artifact.code)}?version=${encodeURIComponent(metadata.version)}&offset=${metadata.byteOffset}&length=${length}`;
  const blocks: ToolResult["content"] = [];
  const resource = {
    type: "resource" as const,
    resource: { uri, mimeType: artifact.mediaType, blob: dataBase64 },
  };
  const mediaType = artifact.mediaType.toLowerCase();
  if (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "image/svg+xml"
  ) {
    try {
      entry.content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        Buffer.from(dataBase64, "base64"),
      );
      if (mediaType === "image/svg+xml") blocks.push(resource);
    } catch {
      blocks.push({
        type: "text",
        text: `Cannot decode artifact ${artifact.code} as UTF-8. The blob resource has the original bytes. Download the artifact or decode it with the correct encoding.`,
      });
      blocks.push(resource);
    }
  } else if (
    taskAssetMediaTypeSchema.options.some((type) => type === mediaType) &&
    metadata.byteOffset === 0 &&
    metadata.nextByteOffset === null
  ) {
    blocks.push({
      type: "image",
      mimeType: mediaType,
      data: dataBase64,
    });
  } else {
    blocks.push(resource);
  }
  return { entry, blocks };
};
