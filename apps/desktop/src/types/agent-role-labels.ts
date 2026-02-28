import type { AgentRole } from "@openducktor/core";

export const AGENT_ROLE_LABELS = Object.freeze({
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
} satisfies Record<AgentRole, string>);
