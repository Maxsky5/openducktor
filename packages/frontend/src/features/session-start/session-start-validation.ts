import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentRole, AgentSessionStartMode } from "@openducktor/core";
import { runtimeSupportsStartMode } from "@/lib/agent-runtime";

export const assertRuntimeSupportsSelectedStartMode = ({
  launchActionId,
  role,
  runtimeDescriptor,
  runtimeKind,
  startMode,
  taskId,
}: {
  launchActionId: string;
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor | null;
  runtimeKind: RuntimeKind | null;
  startMode: AgentSessionStartMode;
  taskId: string;
}): void => {
  if (!runtimeDescriptor) {
    throw new Error(
      `Starting a ${role} ${launchActionId} session for ${taskId} requires a runtime that supports ${startMode} session starts.`,
    );
  }
  if (runtimeSupportsStartMode(runtimeDescriptor, startMode)) {
    return;
  }

  const runtimeLabel = runtimeDescriptor.label || runtimeKind || runtimeDescriptor.kind;
  throw new Error(
    `Runtime "${runtimeLabel}" does not support ${startMode} session starts for ${launchActionId}. Select a compatible runtime or start mode.`,
  );
};
