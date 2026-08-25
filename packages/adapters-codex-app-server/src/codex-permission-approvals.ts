import type { AgentApprovalMutation } from "@openducktor/core";
import type { CodexServerRequestRecord } from "./types";

type CodexPermissionRequest = Extract<
  CodexServerRequestRecord,
  { method: "item/permissions/requestApproval" }
>;

const hasArrayEntries = (value: readonly string[] | null | undefined): boolean =>
  Array.isArray(value) && value.length > 0;

export const classifyCodexPermissionRequestMutation = (
  request: CodexPermissionRequest,
): AgentApprovalMutation => {
  const { permissions } = request.params;
  const fileSystem = permissions.fileSystem;
  if (fileSystem === null) {
    return "unknown";
  }

  if (hasArrayEntries(fileSystem.write)) {
    return "mutating";
  }

  if (fileSystem.entries?.some((entry) => entry.access === "write") === true) {
    return "mutating";
  }

  return "unknown";
};
