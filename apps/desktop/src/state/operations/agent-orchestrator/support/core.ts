import type { AgentRole } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

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
  activeRepoRef,
  previousRepoRef,
}: {
  repoPath: string;
  repoEpochRef: RefValue<number>;
  activeRepoRef: RefValue<string | null> | undefined;
  previousRepoRef: RefValue<string | null>;
}): (() => boolean) => {
  const repoEpochAtStart = repoEpochRef.current;
  const currentRepoAt = (): string | null => activeRepoRef?.current ?? previousRepoRef.current;
  return (): boolean => repoEpochRef.current !== repoEpochAtStart || currentRepoAt() !== repoPath;
};

export const throwIfRepoStale = (isStaleRepoOperation: () => boolean, message: string): void => {
  if (isStaleRepoOperation()) {
    throw new Error(message);
  }
};
