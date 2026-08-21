import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  OdtToolErrorCode,
  OdtToolErrorIssue,
  OdtToolErrorPayload,
} from "@openducktor/contracts";
import { readTaskAssetsResultSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { JsonValue } from "@openducktor/contracts";

export type ToolResult = CallToolResult;

export type OdtToolErrorDetails = Record<string, JsonValue>;

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

  constructor({ code, message, details, issues }: OdtToolErrorInput) {
    super(message);
    this.name = "OdtToolError";
    this.code = code;
    this.details = details;
    this.issues = issues;
  }
}

type ZodIssueSummary = OdtToolErrorIssue;

export const toErrorMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  if (typeof cause === "string" && cause.trim().length > 0) {
    return cause.trim();
  }
  if (typeof cause === "number" || typeof cause === "boolean") {
    return String(cause);
  }
  return "Unknown error";
};

const isStructuredToolPayload = (
  payload: JsonValue | undefined,
): payload is Record<string, JsonValue> => {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
};

const summarizeIssue = (issue: {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
}): ZodIssueSummary => ({
  path: issue.path.filter((entry): entry is string | number => {
    return typeof entry === "string" || typeof entry === "number";
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

export const toToolResult = (payload: JsonValue | undefined): ToolResult => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(isStructuredToolPayload(payload) ? { structuredContent: payload } : {}),
  };
};

export const toTaskAssetsToolResult = (payload: JsonValue | undefined): ToolResult => {
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
  const errorPayload: OdtToolErrorPayload = {
    ok: false,
    error: {
      code,
      message,
      ...(cause instanceof OdtToolError && cause.details ? { details: cause.details } : {}),
      ...(issues ? { issues } : {}),
    },
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
