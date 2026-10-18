import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";

export type ToolMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;
export type SubagentMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "subagent" }>;
