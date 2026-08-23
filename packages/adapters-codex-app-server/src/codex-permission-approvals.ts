import { codexAppServerRequestPermissionProfileSchema } from "@openducktor/contracts";
import type { AgentApprovalMutation } from "@openducktor/core";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexServerRequestRecord } from "./types";

const hasArrayEntries = (value: readonly string[] | null | undefined): boolean =>
  Array.isArray(value) && value.length > 0;

export const classifyCodexPermissionRequestMutation = (
  request: CodexServerRequestRecord,
): AgentApprovalMutation => {
  if (!isPlainObject(request.params)) {
    return "unknown";
  }

  const parsed = codexAppServerRequestPermissionProfileSchema.safeParse(request.params.permissions);
  if (!parsed.success) {
    return "unknown";
  }
  const permissions = parsed.data;

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
