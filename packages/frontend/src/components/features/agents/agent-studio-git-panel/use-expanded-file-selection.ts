import { useCallback, useState } from "react";

/** Expanded diffs per Git context. Keys hold the list and the path, so refresh keeps open diffs. */
export function useExpandedFileSelection(contextKey: string) {
  const [state, setState] = useState<{ contextKey: string; files: Set<string> }>({
    contextKey,
    files: new Set(),
  });
  const files = state.contextKey === contextKey ? state.files : EMPTY_EXPANDED;
  const update = useCallback(
    (change: (files: Set<string>) => void) =>
      setState((current) => {
        const next = new Set(current.contextKey === contextKey ? current.files : EMPTY_EXPANDED);
        change(next);
        return { contextKey, files: next };
      }),
    [contextKey],
  );
  const toggle = useCallback(
    (fileKey: string) =>
      update((next) => {
        if (next.has(fileKey)) next.delete(fileKey);
        else next.add(fileKey);
      }),
    [update],
  );
  return { files, toggle };
}

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();
