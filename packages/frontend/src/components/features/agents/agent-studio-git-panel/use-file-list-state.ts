import type { GitFileDiff } from "@openducktor/contracts";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { collectDirectoryPaths, type DirectoryRow } from "./file-list-rows";
import { toSearchQuery } from "./file-list-search";

export type FileListSearch = {
  searchText: string;
  setSearchText: (text: string) => void;
  /** The search text that the list uses. It can lag behind `searchText` while the list updates. */
  appliedSearchText: string;
  /** `appliedSearchText` in the form that `searchFiles` takes. */
  query: string;
};

export type FileListState = FileListSearch & {
  closedDirectories: ReadonlySet<string>;
  toggleDirectory: (directory: DirectoryToggle) => void;
};

/** Search text for the file lists of one subject. Grouped lists share it. */
export function useFileListSearch(subjectKey: string): FileListSearch {
  const [searchSubjectKey, setSearchSubjectKey] = useState(subjectKey);
  const [searchText, setSearchText] = useState("");
  if (searchSubjectKey !== subjectKey) {
    setSearchSubjectKey(subjectKey);
    setSearchText("");
  }
  const deferredSearchText = useDeferredValue(searchText);
  // Show all files at once when the field is cleared.
  const appliedSearchText = searchText === "" ? "" : deferredSearchText;
  const query = toSearchQuery(appliedSearchText);
  return useMemo(
    () => ({ searchText, setSearchText, appliedSearchText, query }),
    [appliedSearchText, query, searchText],
  );
}

/** Directory open state for one git panel file list. */
export function useFileListState({
  subjectKey,
  listKey,
  fileDiffs,
  search,
}: {
  /** Identifies the task or session that the panel shows. */
  subjectKey: string;
  /** Identifies the list, for example one local group. */
  listKey: string;
  /** Keep the same array while the files stay the same. A new array on each render loops. */
  fileDiffs: readonly GitFileDiff[];
  search: FileListSearch;
}): FileListState {
  const { query } = search;
  const [directoryState, setDirectoryState] = useState<DirectoryState>(() => ({
    subjectKey,
    listKey,
    query,
    fileDiffs,
    closed: NO_CLOSED_DIRECTORIES,
    searchClosed: NO_CLOSED_DIRECTORIES,
  }));
  let currentDirectoryState = directoryState;
  if (
    directoryState.subjectKey !== subjectKey ||
    directoryState.listKey !== listKey ||
    directoryState.query !== query ||
    directoryState.fileDiffs !== fileDiffs
  ) {
    currentDirectoryState = nextDirectoryState(directoryState, {
      subjectKey,
      listKey,
      query,
      fileDiffs,
    });
    setDirectoryState(currentDirectoryState);
  }

  const toggleDirectory = useCallback(({ path, chainPaths }: DirectoryToggle): void => {
    setDirectoryState((current) => {
      const field = current.query === "" ? "closed" : "searchClosed";
      const closed = current[field];
      const next = new Set(closed);
      // A joined row is closed when any of its directories is closed.
      if (chainPaths.some((chainPath) => closed.has(chainPath))) {
        for (const chainPath of chainPaths) {
          next.delete(chainPath);
        }
      } else {
        next.add(path);
      }
      return { ...current, [field]: next };
    });
  }, []);

  const closedDirectories =
    currentDirectoryState.query === ""
      ? currentDirectoryState.closed
      : currentDirectoryState.searchClosed;
  return useMemo(
    () => ({ ...search, closedDirectories, toggleDirectory }),
    [closedDirectories, search, toggleDirectory],
  );
}

type DirectoryToggle = Pick<DirectoryRow, "path" | "chainPaths">;

const NO_CLOSED_DIRECTORIES: ReadonlySet<string> = new Set();

type DirectoryState = {
  subjectKey: string;
  listKey: string;
  query: string;
  fileDiffs: readonly GitFileDiff[];
  /** Closed directories outside a search. A directory that is not in the set is open. */
  closed: ReadonlySet<string>;
  /** Closed directories during the current search query. */
  searchClosed: ReadonlySet<string>;
};

function keepPaths(paths: ReadonlySet<string>, present: ReadonlySet<string>): ReadonlySet<string> {
  if (paths.size === 0) {
    return paths;
  }
  const kept = new Set([...paths].filter((path) => present.has(path)));
  return kept.size === paths.size ? paths : kept;
}

function nextDirectoryState(
  state: DirectoryState,
  input: Pick<DirectoryState, "subjectKey" | "listKey" | "query" | "fileDiffs">,
): DirectoryState {
  const isNewOwner = state.subjectKey !== input.subjectKey || state.listKey !== input.listKey;
  let closed = isNewOwner ? NO_CLOSED_DIRECTORIES : state.closed;
  // A new query opens every directory with a match. The state from before the search stays.
  let searchClosed =
    isNewOwner || state.query !== input.query ? NO_CLOSED_DIRECTORIES : state.searchClosed;
  if (state.fileDiffs !== input.fileDiffs && (closed.size > 0 || searchClosed.size > 0)) {
    // A directory that leaves the change set starts open when it comes back.
    const present = collectDirectoryPaths(input.fileDiffs);
    closed = keepPaths(closed, present);
    searchClosed = keepPaths(searchClosed, present);
  }
  return { ...input, closed, searchClosed };
}
