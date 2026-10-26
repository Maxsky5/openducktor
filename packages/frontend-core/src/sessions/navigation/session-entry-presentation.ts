import type { TerminalContext } from "@openducktor/contracts";
import type { AgentWorkflowStepTone } from "../../types/agent-workflow";
import type { SessionNavigationEntry } from "./session-navigation-read-model";

/**
 * The state of the role or chat icon of a session row: a workflow tone, or muted. Each client
 * maps the tone to its own color.
 */
export type SessionEntryIconTone = AgentWorkflowStepTone | "muted";

/** Task role icons follow the workflow rail. Known attention always keeps its warning cue. */
export const sessionEntryIconTone = (entry: SessionNavigationEntry): SessionEntryIconTone => {
  if (entry.attention.length > 0) return "waiting_input";
  if (entry.status.kind === "checking" || entry.status.kind === "unavailable") return "muted";
  if (entry.workflowTone !== null) return entry.workflowTone;
  if (entry.status.kind === "running") return "in_progress";
  if (entry.status.failed) return "failed";
  return "muted";
};

/** The state of a session row title. */
export type SessionEntryTitleTone = "attention" | "read" | "default";

/** The title shows attention when the session needs you, and dims when it is read and settled. */
export const sessionEntryTitleTone = (
  entry: SessionNavigationEntry,
  unread: boolean,
): SessionEntryTitleTone => {
  if (entry.attention.length > 0) return "attention";
  if (entry.status.kind === "settled" && !unread) return "read";
  return "default";
};

/** The state of the status dot of a session row. */
export type SessionEntryDotTone = "input_unread" | "input_read" | "running" | "unread" | "read";

/** The dot shows the read state in the input colors when the session needs you, else running. */
export const sessionEntryDotTone = (
  entry: SessionNavigationEntry,
  unread: boolean,
): SessionEntryDotTone => {
  if (entry.attention.length > 0) return unread ? "input_unread" : "input_read";
  if (entry.status.kind === "running") return "running";
  return unread ? "unread" : "read";
};

/** The working directory and runtime session ID of an entry, for the copy actions. */
export type SessionEntryLocation = {
  workingDirectory: string | null;
  externalSessionId: string | null;
};

export const sessionEntryLocation = (entry: SessionNavigationEntry): SessionEntryLocation => {
  if (entry.context.kind === "workspace") {
    const { session } = entry.context;
    return {
      workingDirectory: session.executionTarget.workingDirectory,
      externalSessionId: session.externalSessionId,
    };
  }
  const identity = entry.target.kind === "task_session" ? entry.target.identity : null;
  return {
    workingDirectory: identity?.workingDirectory ?? null,
    externalSessionId: identity?.externalSessionId ?? null,
  };
};

/** The terminal context of the task or chat of an entry, for its active command marks. */
export const sessionEntryTerminalContext = (entry: SessionNavigationEntry): TerminalContext => {
  const { repoPath, workspaceId } = entry.workspace;
  return entry.context.kind === "task"
    ? { repoPath, taskId: entry.context.task.id }
    : { kind: "workspace_session", repoPath, workspaceId, sessionId: entry.context.session.id };
};
