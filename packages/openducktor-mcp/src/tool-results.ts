import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  JsonObject,
  JsonValue,
  OdtToolErrorCode,
  OdtToolErrorIssue,
  OdtToolErrorPayload,
} from "@openducktor/contracts";
import { isJsonObject, readTaskAssetsResultSchema } from "@openducktor/contracts";
import { z } from "zod";

export type ToolResult = CallToolResult;

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

const isStructuredToolPayload = (payload: JsonValue): payload is JsonObject =>
  isJsonObject(payload);

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

export const toToolResult = (payload: JsonValue): ToolResult => {
  const result: ToolResult = {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
  if (isStructuredToolPayload(payload)) result.structuredContent = payload;
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
  if (cause instanceof OdtToolError && cause.details) error.details = cause.details;
  if (issues) error.issues = issues;
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
