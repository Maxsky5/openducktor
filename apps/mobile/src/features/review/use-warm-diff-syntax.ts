import { useEffect } from "react";
import type { PreparedFileDiff } from "./prepared-diff";

/**
 * Highlights the shown diffs ahead of the scroll, one chunk per idle moment of the JavaScript
 * thread. A row then finds its tokens ready, and a fast scroll does not wait for a highlight.
 */
export function useWarmDiffSyntax(diffs: readonly PreparedFileDiff[]): void {
  useEffect(() => {
    const pending = diffs.flatMap((diff) => (diff.syntax ? [diff.syntax] : []));
    if (pending.length === 0) return;
    let handle: number | null = null;
    const step = (): void => {
      const syntax = pending[0];
      if (!syntax) return;
      if (!syntax.warmNextChunk()) pending.shift();
      if (pending.length > 0) handle = requestIdleCallback(step);
    };
    handle = requestIdleCallback(step);
    return () => {
      if (handle !== null) cancelIdleCallback(handle);
    };
  }, [diffs]);
}
