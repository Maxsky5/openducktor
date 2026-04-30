import type { AgentSessionState } from "@/types/agent-orchestrator";

const WORKTREE_RUNTIME_ROLES = new Set<AgentSessionState["role"]>(["build", "qa"]);

type RuntimeAttachmentState = Pick<AgentSessionState, "runtimeId">;
type WorktreeRuntimeRole = Pick<AgentSessionState, "role">;

export const requiresLiveWorktreeRuntime = (
  session: WorktreeRuntimeRole | null | undefined,
): boolean => {
  return Boolean(session && WORKTREE_RUNTIME_ROLES.has(session.role));
};

export const hasAttachedSessionRuntime = (
  session: RuntimeAttachmentState | null | undefined,
): boolean => {
  if (!session) {
    return false;
  }

  return session.runtimeId !== null;
};

export const isWaitingForAttachedWorktreeRuntime = (
  session: (WorktreeRuntimeRole & RuntimeAttachmentState) | null | undefined,
): boolean => {
  return requiresLiveWorktreeRuntime(session) && !hasAttachedSessionRuntime(session);
};
