import { workflowRoleIcon } from "@openducktor/workflows";
import type { ReactElement } from "react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import { useChatWorkflowTask } from "./agent-chat-workflow-context";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";

export function AssistantRoleIcon({ role }: { role: AgentRole }): ReactElement {
  const task = useChatWorkflowTask();
  const RoleIcon = roleIconForHint(task ? workflowRoleIcon(task.taskWorkflow, role) : undefined);
  return <RoleIcon className="size-3" />;
}
