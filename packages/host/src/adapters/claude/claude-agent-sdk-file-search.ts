import type { WorkspaceFileSearch } from "../file-search/workspace-file-search";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";

export type ClaudeFileSearchSessionStore = Pick<ClaudeSessionStore, "subscribeClose" | "values">;

export const trackClaudeFileSearchSessions = ({
  fileSearch,
  sessionStore,
}: {
  fileSearch: WorkspaceFileSearch;
  sessionStore: ClaudeFileSearchSessionStore;
}): (() => void) =>
  sessionStore.subscribeClose((session) => {
    const workingDirectory = session.input.workingDirectory;
    const inUse = [...sessionStore.values()].some(
      (other) => other.input.workingDirectory === workingDirectory,
    );
    if (!inUse) {
      fileSearch.release(workingDirectory);
    }
  });
