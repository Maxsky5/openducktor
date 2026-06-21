import { isCodexAppServerRequestPermissionProfile } from "@openducktor/contracts";
import type { AgentApprovalMutation } from "@openducktor/core";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexServerRequestRecord } from "./types";

const hasArrayEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

export const classifyCodexPermissionRequestMutation = (
  request: CodexServerRequestRecord,
): AgentApprovalMutation => {
  if (!isPlainObject(request.params)) {
    return "unknown";
  }

  const permissions = request.params.permissions;
  if (!isCodexAppServerRequestPermissionProfile(permissions)) {
    return "unknown";
  }

  if (permissions.network?.enabled === true) {
    return "mutating";
  }

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
