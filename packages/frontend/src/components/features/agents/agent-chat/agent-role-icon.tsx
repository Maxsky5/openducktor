import type { ReactElement } from "react";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";
import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";

export function AssistantRoleIcon({ role }: { role: AgentRole }): ReactElement {
  const RoleIcon = AGENT_ROLE_ICONS[role];
  return <RoleIcon className="size-3" />;
}
