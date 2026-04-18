import type { AgentRole } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";

export { normalizeWorkingDirectory } from "@/lib/working-directory";

export const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

export const runningStates = new Set([
  "starting",
  "running",
  "blocked",
  "awaiting_done_confirmation",
]);

export const now = (): string => new Date().toISOString();
export const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

export const sanitizeStreamingText = (value: string): string => {
  return value.replace(/\n{3,}/g, "\n\n").trimStart();
};

export const shouldReattachListenerForAttachedSession = (
  status: AgentSessionState["status"] | null | undefined,
  hasActiveUnsubscriber: boolean,
): boolean => status !== "error" && !hasActiveUnsubscriber;

type RefValue<T> = { current: T };

export const createRepoStaleGuard = ({
  repoPath,
  repoEpochRef,
  activeWorkspaceRef,
  currentWorkspaceRepoPathRef,
}: {
  repoPath: string;
  repoEpochRef: RefValue<number>;
  activeWorkspaceRef?: RefValue<ActiveWorkspace | null>;
  currentWorkspaceRepoPathRef: RefValue<string | null>;
}): (() => boolean) => {
  const repoEpochAtStart = repoEpochRef.current;
  const currentRepoAt = (): string | null =>
    currentWorkspaceRepoPathRef.current ?? activeWorkspaceRef?.current?.repoPath ?? null;
  return (): boolean => repoEpochRef.current !== repoEpochAtStart || currentRepoAt() !== repoPath;
};

export const throwIfRepoStale = (isStaleRepoOperation: () => boolean, message: string): void => {
  if (isStaleRepoOperation()) {
    throw new Error(message);
  }
};
