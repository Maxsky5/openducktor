import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { type ReactElement, type ReactNode, useMemo } from "react";
import { PIERRE_DIFF_THEME } from "@/lib/diff/pierre-config";
import { workerFactory } from "@/lib/diff/workerFactory";

/**
 * Keeps the diff workers warm across page and workspace switches.
 * Pierre also initializes Highlights on the main thread for the editor.
 */
export function DiffWorkerProvider({ children }: { children: ReactNode }): ReactElement {
  const poolSize = useMemo(() => {
    if (globalThis.navigator === undefined) {
      return 2;
    }

    const concurrency = navigator.hardwareConcurrency || 2;
    return Math.min(Math.max(1, concurrency - 1), 3);
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory,
        poolSize,
        totalASTLRUCacheSize: 56,
      }}
      highlighterOptions={{
        preferredHighlighter: "highlights",
        theme: PIERRE_DIFF_THEME,
        lineDiffType: "word-alt",
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
