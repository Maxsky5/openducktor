export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
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
  const code =
    error instanceof Error && error.name === "ZodError"
      ? "ODT_TOOL_INPUT_INVALID"
      : "ODT_TOOL_EXECUTION_ERROR";
  const errorPayload = {
    ok: false,
    error: {
      code,
      message,
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
