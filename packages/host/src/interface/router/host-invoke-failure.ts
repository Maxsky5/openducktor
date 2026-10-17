import {
  hostInvokeFailureSchema,
  type AgentSessionResumeFailure,
  type HostInvokeFailure,
} from "@openducktor/contracts";
import { RuntimeQueryError } from "../../ports/runtime-query-error";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionCommandAcceptedError,
} from "../../ports/agent-session-send-error";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import { WorkspaceTextFileWriteError } from "../../application/filesystem/workspace-text-file-service";
import {
  TerminalServiceError,
  terminalServiceErrorToFailure,
} from "../../application/terminals/terminal-service";
import { TaskAssetError, taskAssetErrorToFailure } from "../../effect/task-asset-error";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import {
  HostOperationError,
  HostValidationError,
  readRuntimeOperationFailure,
} from "../../effect/host-errors";
import { SessionOperationError } from "../../ports/session-operation-error";
import { WorkflowIntentRejectedError } from "../../ports/workflow-intent-rejected-error";

export const hostInvokeFailureFromError = (cause: unknown): HostInvokeFailure | undefined => {
  if (cause instanceof SessionOperationError)
    return { kind: "session_operation", observation: cause.observation };
  if (cause instanceof WorkflowIntentRejectedError) return { kind: "workflow_intent_rejected" };
  if (cause instanceof HostOperationError && cause.details?.hostInvokeFailure !== undefined) {
    return hostInvokeFailureSchema.parse(cause.details.hostInvokeFailure);
  }
  if (cause instanceof AgentSessionCommandAcceptedError) return cause.failure;
  if (cause instanceof RuntimeQueryError) {
    return { kind: "runtime_query", runtimeQueryFailure: cause.failure };
  }
  if (cause instanceof AgentSessionMessageAcceptedError) {
    return cause.failure;
  }
  if (cause instanceof AgentSessionResumeError) {
    const agentSessionResumeFailure: AgentSessionResumeFailure = {
      reason: cause.reason,
      sessionRef: cause.sessionRef,
      operation: cause.resumeOperation,
      message: cause.message,
      nextAction: cause.nextAction,
    };
    if (cause.nativeOutcome) agentSessionResumeFailure.nativeOutcome = cause.nativeOutcome;
    if (cause.cause instanceof Error) {
      agentSessionResumeFailure.cause = cause.cause.message;
    }
    return { kind: "agent_session_resume", agentSessionResumeFailure };
  }
  if (cause instanceof HostValidationError && cause.field === "confirmStop") {
    return { kind: "workspace_session_confirmation", field: cause.field };
  }
  if (
    cause instanceof HostValidationError &&
    (cause.field === "worktree.name" || cause.field === "worktree.branchName")
  ) {
    return { kind: "workspace_session_validation", field: cause.field };
  }
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
  return readRuntimeOperationFailure(cause);
};
