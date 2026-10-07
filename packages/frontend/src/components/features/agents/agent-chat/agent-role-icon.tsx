import type { AgentRole } from "@openducktor/core";
import type { ReactElement } from "react";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";

export function AssistantRoleIcon({ role }: { role: AgentRole }): ReactElement {
  const RoleIcon = AGENT_ROLE_ICONS[role];
  return <RoleIcon className="size-3" />;
}
