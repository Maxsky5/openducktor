import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentSessionMessages } from "../../../types/agent-orchestrator";
import { type SessionMessageOwner, updateSessionMessagesByRole } from "./support/messages";

type ToolStatus = "pending" | "running" | "completed" | "error";
type ToolCompletionOutcome = "completed" | "error";

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
  session: SessionMessageOwner,
  timestamp: string,
  options?: {
    outcome?: ToolCompletionOutcome;
    errorMessage?: string;
  },
): AgentSessionMessages => {
  const outcome = options?.outcome ?? "completed";
  const parsedEndedAt = Date.parse(timestamp);
  const endedAtMs = Number.isNaN(parsedEndedAt) ? undefined : parsedEndedAt;

  return updateSessionMessagesByRole(session, "tool", (message) => {
    if (message.meta?.kind !== "tool") {
      return message;
    }

    const meta = message.meta;
    if (meta.toolType !== "todo" || !isRunningToolStatus(meta.status)) {
      return message;
    }

    const errorText = options?.errorMessage?.trim() || meta.error || "Tool failed";
    const updatedStatus: ToolStatus = outcome === "error" ? "error" : "completed";
    const updatedMeta = {
      ...meta,
      status: updatedStatus,
      ...(!hasRuntimeType(meta.endedAtMs, "number") && hasRuntimeType(endedAtMs, "number")
        ? { endedAtMs }
        : undefined),
      ...(updatedStatus === "error" ? { error: errorText } : undefined),
    };

    return {
      ...message,
      timestamp,
      content: formatToolContent({
        tool: meta.tool,
        status: updatedStatus,
        ...(meta.title ? { title: meta.title } : undefined),
        ...(meta.output ? { output: meta.output } : undefined),
        ...(updatedStatus === "error" ? { error: errorText } : undefined),
      }),
      meta: updatedMeta,
    };
  });
};
