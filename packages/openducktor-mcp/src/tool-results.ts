import { z } from "zod";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type OdtToolErrorCode =
  | "ODT_TOOL_INPUT_INVALID"
  | "ODT_WORKSPACE_SCOPE_VIOLATION"
  | "ODT_WORKSPACE_MISSING"
  | "ODT_HOST_BRIDGE_ERROR"
  | "ODT_HOST_RESPONSE_INVALID"
  | "ODT_TOOL_EXECUTION_ERROR";

export type OdtToolErrorDetails = Record<string, unknown>;

export class OdtToolError extends Error {
  readonly code: OdtToolErrorCode;
  readonly details: OdtToolErrorDetails | undefined;

  constructor(code: OdtToolErrorCode, message: string, details?: OdtToolErrorDetails) {
    super(message);
    this.name = "OdtToolError";
    this.code = code;
    this.details = details;
  }
}

type ZodIssueSummary = {
  path: Array<string | number>;
  message: string;
  code: string;
};

export const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown error";
};

const isStructuredToolPayload = (payload: unknown): payload is Record<string, unknown> => {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
};

const readZodIssues = (error: unknown): ZodIssueSummary[] | undefined => {
  if (!(error instanceof z.ZodError) && !isStructuredToolPayload(error)) {
    return undefined;
  }

  const issues =
    error instanceof z.ZodError ? error.issues : (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return undefined;
  }

  const normalized = issues
    .map((issue): ZodIssueSummary | undefined => {
      if (!isStructuredToolPayload(issue)) {
        return undefined;
      }
      const path = Array.isArray(issue.path)
        ? issue.path.filter((entry): entry is string | number => {
            return typeof entry === "string" || typeof entry === "number";
          })
        : [];
      const message = typeof issue.message === "string" ? issue.message : "Invalid input";
      const code = typeof issue.code === "string" ? issue.code : "invalid_input";
      return { path, message, code };
    })
    .filter((issue): issue is ZodIssueSummary => issue !== undefined);

  return normalized.length > 0 ? normalized : undefined;
};

export const toToolResult = (payload: unknown): ToolResult => {
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

export const toToolError = (error: unknown): ToolResult => {
  const message = toErrorMessage(error);
  const zodIssues = readZodIssues(error);
  const code =
    error instanceof OdtToolError
      ? error.code
      : zodIssues
        ? "ODT_TOOL_INPUT_INVALID"
        : "ODT_TOOL_EXECUTION_ERROR";
  const errorPayload = {
    ok: false,
    error: {
      code,
      message,
      ...(error instanceof OdtToolError && error.details ? { details: error.details } : {}),
      ...(zodIssues ? { issues: zodIssues } : {}),
    },
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(errorPayload, null, 2),
      },
    ],
    structuredContent: errorPayload,
    isError: true,
  };
};
