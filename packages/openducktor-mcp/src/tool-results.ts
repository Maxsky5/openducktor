import type {
  OdtToolErrorCode,
  OdtToolErrorIssue,
  OdtToolErrorPayload,
} from "@openducktor/contracts";
import { z } from "zod";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

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

type ZodIssueSummary = OdtToolErrorIssue;

export const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  return "Unknown error";
};

const isStructuredToolPayload = (payload: unknown): payload is Record<string, unknown> => {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
};

const normalizeIssues = (issues: unknown): ZodIssueSummary[] | undefined => {
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

const readZodIssues = (error: unknown): ZodIssueSummary[] | undefined => {
  return error instanceof z.ZodError ? normalizeIssues(error.issues) : undefined;
};

const readOdtToolErrorIssues = (error: unknown): ZodIssueSummary[] | undefined => {
  if (!(error instanceof OdtToolError) || !error.details) {
    return undefined;
  }

  return normalizeIssues(error.details.issues);
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
  const odtIssues = readOdtToolErrorIssues(error);
  const issues = odtIssues ?? zodIssues;
  const code =
    error instanceof OdtToolError
      ? error.code
      : zodIssues
        ? "ODT_TOOL_INPUT_INVALID"
        : "ODT_TOOL_EXECUTION_ERROR";
  const errorPayload: OdtToolErrorPayload = {
    ok: false,
    error: {
      code,
      message,
      ...(error instanceof OdtToolError && error.details ? { details: error.details } : {}),
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
    structuredContent: errorPayload,
    isError: true,
  };
};
