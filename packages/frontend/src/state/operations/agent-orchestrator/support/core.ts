export { normalizeWorkingDirectory } from "@/lib/working-directory";

export const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

export const runningStates = new Set([
  "starting",
  "running",
  "blocked",
  "awaiting_done_confirmation",
]);

export const now = (): string => new Date().toISOString();

export const sanitizeStreamingText = (value: string): string => {
  return value.replace(/\n{3,}/g, "\n\n").trimStart();
};

type RefValue<T> = { current: T };

export const createRepoStaleGuard = ({
  repoPath,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
}: {
  repoPath: string;
  repoEpochRef: RefValue<number>;
  currentWorkspaceRepoPathRef: RefValue<string | null>;
}): (() => boolean) => {
  const repoEpochAtStart = repoEpochRef.current;
  return (): boolean =>
    repoEpochRef.current !== repoEpochAtStart || currentWorkspaceRepoPathRef.current !== repoPath;
};

export const throwIfRepoStale = (isStaleRepoOperation: () => boolean, message: string): void => {
  if (isStaleRepoOperation()) {
    throw new Error(message);
  }
};
