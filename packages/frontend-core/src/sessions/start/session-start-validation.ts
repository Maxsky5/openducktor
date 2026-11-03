import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionStartMode } from "@openducktor/core";
import { runtimeSupportsRole, runtimeSupportsStartMode } from "../../lib/agent-runtime";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";

export const assertRuntimeSupportsSelectedStartMode = ({
  launchActionId,
  role,
  runtimeDescriptor,
  runtimeKind,
  startMode,
  taskId,
  taskWorkflow,
}: {
  launchActionId: string;
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor | null;
  runtimeKind: RuntimeKind | null;
  startMode: AgentSessionStartMode;
  taskId: string;
  taskWorkflow: import("@openducktor/workflows").TaskWorkflow;
}): void => {
  if (!runtimeDescriptor) {
    throw new Error(
      `Starting a ${role} ${launchActionId} session for ${taskId} requires a runtime that supports ${startMode} session starts.`,
    );
  }
  if (!runtimeSupportsRole(runtimeDescriptor, taskWorkflow.role(role)))
    throw new Error(
      `Runtime "${runtimeDescriptor.label}" does not support workflow role "${role}". Select a compatible runtime.`,
    );
  if (runtimeSupportsStartMode(runtimeDescriptor, startMode)) {
    return;
  }

  const runtimeLabel = runtimeDescriptor.label || runtimeKind || runtimeDescriptor.kind;
  throw new Error(
    `Runtime "${runtimeLabel}" does not support ${startMode} session starts for ${launchActionId}. Select a compatible runtime or start mode.`,
  );
};
