import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentStreamPart } from "@openducktor/core";

const toDisplayText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  if (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const outputTextFromMcpPayload = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textChunks = content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const text = (entry as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : null;
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (textChunks.length === 0) {
    return undefined;
  }
  return textChunks.join("\n");
};

const readToolOutputText = (value: unknown): string | undefined => {
  return outputTextFromMcpPayload(value) ?? toDisplayText(value);
};

const isToolOutputError = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const isError = (value as { isError?: unknown }).isError;
  return isError === true;
};

const normalizeMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const normalized = value as Record<string, unknown>;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const extractPartTiming = (
  part: Part,
): {
  startedAtMs?: number;
  endedAtMs?: number;
} => {
  const direct = (part as { time?: { start?: unknown; end?: unknown } }).time;
  const fromDirectStart = typeof direct?.start === "number" ? direct.start : undefined;
  const fromDirectEnd = typeof direct?.end === "number" ? direct.end : undefined;

  const stateTime = (part as { state?: { time?: { start?: unknown; end?: unknown } } }).state?.time;
  const fromStateStart = typeof stateTime?.start === "number" ? stateTime.start : undefined;
  const fromStateEnd = typeof stateTime?.end === "number" ? stateTime.end : undefined;

  const startedAtMs = fromDirectStart ?? fromStateStart;
  const endedAtMs = fromDirectEnd ?? fromStateEnd;

  return {
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };
};

export const mapPartToAgentStreamPart = (part: Part): AgentStreamPart | null => {
  switch (part.type) {
    case "text":
      return {
        kind: "text",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        ...(part.synthetic !== undefined ? { synthetic: part.synthetic } : {}),
        completed: Boolean(part.time?.end),
      };
    case "reasoning":
      return {
        kind: "reasoning",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        completed: Boolean(part.time?.end),
      };
    case "tool": {
      const toolState = part.state as Record<string, unknown>;
      const timing = extractPartTiming(part);
      const metadata = normalizeMetadata(
        (part as { state?: { metadata?: unknown } }).state?.metadata,
      );
      const rawStatus =
        typeof part.state.status === "string" ? part.state.status.trim().toLowerCase() : "";
      const hasEndedTiming = typeof timing.endedAtMs === "number";
      const normalizedStatus: "pending" | "running" | "completed" | "error" = (() => {
        if (rawStatus === "completed") {
          return "completed";
        }
        if (rawStatus === "error" || rawStatus === "failed") {
          return "error";
        }
        if (rawStatus === "pending") {
          return hasEndedTiming ? "completed" : "pending";
        }
        if (rawStatus === "running" || rawStatus === "started") {
          return hasEndedTiming ? "completed" : "running";
        }
        return hasEndedTiming ? "completed" : "running";
      })();

      if (normalizedStatus === "pending") {
        return {
          kind: "tool",
          messageId: part.messageID,
          partId: part.id,
          callId: part.callID,
          tool: part.tool,
          status: "pending",
          input: part.state.input,
          ...(metadata ? { metadata } : {}),
          ...timing,
        };
      }
      if (normalizedStatus === "running") {
        const title = toDisplayText(toolState.title);
        return {
          kind: "tool",
          messageId: part.messageID,
          partId: part.id,
          callId: part.callID,
          tool: part.tool,
          status: "running",
          input: part.state.input,
          ...(title ? { title } : {}),
          ...(metadata ? { metadata } : {}),
          ...timing,
        };
      }
      if (normalizedStatus === "completed") {
        const output = readToolOutputText(toolState.output);
        const error = toDisplayText(toolState.error);
        const title = toDisplayText(toolState.title);
        if (isToolOutputError(toolState.output) || (error && error.trim().length > 0)) {
          const errorText = output ?? error ?? "Tool failed";
          return {
            kind: "tool",
            messageId: part.messageID,
            partId: part.id,
            callId: part.callID,
            tool: part.tool,
            status: "error",
            input: part.state.input,
            error: errorText,
            ...(title ? { title } : {}),
            ...(metadata ? { metadata } : {}),
            ...timing,
          };
        }
        return {
          kind: "tool",
          messageId: part.messageID,
          partId: part.id,
          callId: part.callID,
          tool: part.tool,
          status: "completed",
          input: part.state.input,
          ...(output ? { output } : {}),
          ...(title ? { title } : {}),
          ...(metadata ? { metadata } : {}),
          ...timing,
        };
      }
      const error = toDisplayText(toolState.error);
      return {
        kind: "tool",
        messageId: part.messageID,
        partId: part.id,
        callId: part.callID,
        tool: part.tool,
        status: "error",
        input: part.state.input,
        ...(error ? { error } : {}),
        ...(metadata ? { metadata } : {}),
        ...timing,
      };
    }
    case "step-start":
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "start",
      };
    case "step-finish":
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "finish",
        reason: part.reason,
        cost: part.cost,
      };
    case "subtask":
      return {
        kind: "subtask",
        messageId: part.messageID,
        partId: part.id,
        agent: part.agent,
        prompt: part.prompt,
        description: part.description,
      };
    default:
      return null;
  }
};
