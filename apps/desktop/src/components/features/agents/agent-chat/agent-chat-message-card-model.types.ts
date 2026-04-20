import type { AgentChatMessage } from "@/types/agent-orchestrator";

export type ToolMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;
export type SubagentMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "subagent" }>;
