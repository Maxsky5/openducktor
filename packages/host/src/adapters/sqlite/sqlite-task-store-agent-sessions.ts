import { type AgentSessionRecord, agentSessionRecordSchema } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";

export const compactAgentSessionForStorage = (session: AgentSessionRecord): AgentSessionRecord => {
  const role = session.role.trim();
  if (!role) {
    throw new HostValidationError({ message: "Agent session role is required", field: "role" });
  }
  const externalSessionId = session.externalSessionId.trim();
  if (!externalSessionId) {
    throw new HostValidationError({
      message: "Agent session externalSessionId is required",
      field: "externalSessionId",
    });
  }
  const startedAt = session.startedAt.trim();
  if (!startedAt) {
    throw new HostValidationError({
      message: "Agent session startedAt is required",
      field: "startedAt",
    });
  }
  const runtimeKind = session.runtimeKind.trim();
  if (!runtimeKind) {
    throw new HostValidationError({
      message: "Agent session runtimeKind is required",
      field: "runtimeKind",
    });
  }
  const workingDirectory = session.workingDirectory.trim();
  if (!workingDirectory) {
    throw new HostValidationError({
      message: "Agent session workingDirectory is required",
      field: "workingDirectory",
    });
  }
  const selectedModel =
    session.selectedModel === null
      ? null
      : {
          ...session.selectedModel,
          runtimeKind: session.selectedModel.runtimeKind.trim(),
        };
  if (selectedModel !== null && !selectedModel.runtimeKind) {
    throw new HostValidationError({
      message: "Agent session selectedModel.runtimeKind is required",
      field: "selectedModel.runtimeKind",
    });
  }
  return agentSessionRecordSchema.parse({
    ...session,
    externalSessionId,
    role,
    startedAt,
    runtimeKind,
    workingDirectory,
    selectedModel,
  });
};
