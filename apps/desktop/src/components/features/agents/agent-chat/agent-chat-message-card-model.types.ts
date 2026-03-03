import type { AgentChatMessage } from "@/types/agent-orchestrator";

export type ToolMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;
