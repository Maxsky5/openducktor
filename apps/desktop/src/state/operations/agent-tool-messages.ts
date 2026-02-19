import type { AgentChatMessage } from "../../types/agent-orchestrator";

type ToolStatus = "pending" | "running" | "completed" | "error";
type ToolCompletionOutcome = "completed" | "error";

export const isTodoToolName = (tool: string): boolean => {
  const normalized = tool.trim().toLowerCase();
  return (
    normalized === "todoread" ||
    normalized === "todowrite" ||
    normalized.endsWith("_todoread") ||
    normalized.endsWith("_todowrite")
  );
};

export const isRunningToolStatus = (status: ToolStatus): boolean =>
  status === "pending" || status === "running";

export const formatToolContent = (part: {
  tool: string;
  status: ToolStatus;
  title?: string;
  output?: string;
  error?: string;
}): string => {
  const title = part.title ? ` (${part.title})` : "";
  if (part.status === "completed") {
    return `Tool ${part.tool}${title} completed${part.output ? `\n\n${part.output}` : ""}`;
  }
  if (part.status === "error") {
    return `Tool ${part.tool}${title} failed${part.error ? `\n\n${part.error}` : ""}`;
  }
  if (part.status === "running") {
    return `Tool ${part.tool}${title} running...`;
  }
  return `Tool ${part.tool}${title} queued...`;
};

export const settleDanglingTodoToolMessages = (
  messages: AgentChatMessage[],
  timestamp: string,
  options?: {
    outcome?: ToolCompletionOutcome;
    errorMessage?: string;
  },
): AgentChatMessage[] => {
  const outcome = options?.outcome ?? "completed";
  const parsedEndedAt = Date.parse(timestamp);
  const endedAtMs = Number.isNaN(parsedEndedAt) ? undefined : parsedEndedAt;
  let didChange = false;

  const next = messages.map((message) => {
    if (message.role !== "tool" || message.meta?.kind !== "tool") {
      return message;
    }

    const meta = message.meta;
    if (!isTodoToolName(meta.tool) || !isRunningToolStatus(meta.status)) {
      return message;
    }

    didChange = true;
    const errorText =
      outcome === "error"
        ? options?.errorMessage?.trim() || meta.error || "Tool failed"
        : meta.error;
    const updatedStatus: ToolStatus = outcome === "error" ? "error" : "completed";
    const updatedMeta = {
      ...meta,
      status: updatedStatus,
      ...(typeof meta.endedAtMs === "number"
        ? {}
        : typeof endedAtMs === "number"
          ? { endedAtMs }
          : {}),
      ...(updatedStatus === "error" ? { error: errorText } : {}),
    };

    return {
      ...message,
      timestamp,
      content: formatToolContent({
        tool: meta.tool,
        status: updatedStatus,
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.output ? { output: meta.output } : {}),
        ...(updatedStatus === "error" ? { error: errorText } : {}),
      }),
      meta: updatedMeta,
    };
  });

  return didChange ? next : messages;
};
