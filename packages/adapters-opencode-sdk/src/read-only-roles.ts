import type { AgentRole } from "@openducktor/core";

const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

export const isReadOnlyRole = (role: AgentRole): boolean => READ_ONLY_ROLES.has(role);
