import type { HostInvokeFailure } from "@openducktor/contracts";
import { WorkspaceTextFileWriteError } from "../../application/filesystem/workspace-text-file-service";
import {
  TerminalServiceError,
  terminalServiceErrorToFailure,
} from "../../application/terminals/terminal-service";
import { TaskAssetError, taskAssetErrorToFailure } from "../../effect/task-asset-error";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";

export const hostInvokeFailureFromError = (cause: unknown): HostInvokeFailure | undefined => {
  if (cause instanceof WorkspaceTextFileWriteError) {
    return {
      kind: "workspace_text_file_write",
      workspaceTextFileWriteFailure: cause.failure,
    };
  }
  if (cause instanceof TerminalServiceError) {
    return {
      kind: "terminal",
      terminalFailure: terminalServiceErrorToFailure(cause),
    };
  }
  if (cause instanceof TaskAssetError) {
    return {
      kind: "task_asset",
      taskAssetFailure: taskAssetErrorToFailure(cause),
    };
  }
  if (cause instanceof CodexSessionHistoryError) {
    return {
      kind: "session_history",
      sessionHistoryFailure: cause.failure,
    };
  }
  return undefined;
};
