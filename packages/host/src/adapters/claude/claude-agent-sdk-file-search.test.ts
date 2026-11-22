import { describe, expect, test } from "bun:test";
import {
  createWorkspaceFileSearch,
  type WorkspaceFileFinder,
} from "../file-search/workspace-file-search";
import {
  type ClaudeFileSearchSessionStore,
  trackClaudeFileSearchSessions,
} from "./claude-agent-sdk-file-search";
import type { ClaudeSession } from "./claude-agent-sdk-types";

const createFinderFactory = () => {
  const created: string[] = [];
  const destroyed: string[] = [];
  const createFinder = (workingDirectory: string): WorkspaceFileFinder => {
    created.push(workingDirectory);
    return {
      search: async (query) => [{ id: query, path: query, name: query, kind: "default" }],
      destroy: () => {
        destroyed.push(workingDirectory);
      },
    };
  };
  return { createFinder, created, destroyed };
};

describe("trackClaudeFileSearchSessions", () => {
  const createSessionStore = (
    workingDirectories: string[],
  ): ClaudeFileSearchSessionStore & { close(index: number): void } => {
    const listeners = new Set<(session: ClaudeSession) => void>();
    // SAFETY: The tracker reads only input.workingDirectory from each session.
    const live = workingDirectories.map((workingDirectory) => ({
      input: { workingDirectory },
    })) as ClaudeSession[];
    return {
      subscribeClose: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      values: () => live.values(),
      close: (index) => {
        const [session] = live.splice(index, 1);
        if (!session) {
          throw new Error(`No session at index ${index}.`);
        }
        for (const listener of listeners) {
          listener(session);
        }
      },
    };
  };

  test("releases a finder when the last session for its directory closes", () => {
    const { createFinder, created, destroyed } = createFinderFactory();
    const fileSearch = createWorkspaceFileSearch({ createFinder });
    const sessionStore = createSessionStore(["/repo/a", "/repo/a"]);

    trackClaudeFileSearchSessions({ fileSearch, sessionStore });
    fileSearch.prewarm("/repo/a");
    sessionStore.close(0);
    expect(destroyed).toEqual([]);

    sessionStore.close(0);

    expect(created).toEqual(["/repo/a"]);
    expect(destroyed).toEqual(["/repo/a"]);
  });

  test("releases only the finder of the closed session directory", () => {
    const { createFinder, destroyed } = createFinderFactory();
    const fileSearch = createWorkspaceFileSearch({ createFinder });
    const sessionStore = createSessionStore(["/repo/a", "/repo/b"]);

    trackClaudeFileSearchSessions({ fileSearch, sessionStore });
    fileSearch.prewarm("/repo/a");
    fileSearch.prewarm("/repo/b");
    sessionStore.close(1);

    expect(destroyed).toEqual(["/repo/b"]);
  });

  test("stops releasing finders after the tracking subscription is removed", () => {
    const { createFinder, destroyed } = createFinderFactory();
    const fileSearch = createWorkspaceFileSearch({ createFinder });
    const sessionStore = createSessionStore(["/repo/a"]);
    const untrack = trackClaudeFileSearchSessions({ fileSearch, sessionStore });

    fileSearch.prewarm("/repo/a");
    untrack();
    sessionStore.close(0);

    expect(destroyed).toEqual([]);
  });
});
