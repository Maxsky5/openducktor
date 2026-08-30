import type { FileDiffMetadata } from "@pierre/diffs";
import { useWorkerPool as usePierreWorkerPool } from "@pierre/diffs/react";

type PierreWorkerPoolManager = NonNullable<ReturnType<typeof usePierreWorkerPool>>;

export type PierreDiffViewerWorkerPool = {
  cleanUpTasks: PierreWorkerPoolManager["cleanUpTasks"];
  getDiffResultCache: PierreWorkerPoolManager["getDiffResultCache"];
  getFileResultCache: PierreWorkerPoolManager["getFileResultCache"];
  highlightDiffAST: PierreWorkerPoolManager["highlightDiffAST"];
  highlightFileAST: PierreWorkerPoolManager["highlightFileAST"];
  isWorkingPool: PierreWorkerPoolManager["isWorkingPool"];
  primeDiffHighlightCache: (diff: FileDiffMetadata) => void;
  subscribeToStatChanges: (callback: () => void) => () => void;
};

export const useWorkerPool = (): PierreDiffViewerWorkerPool | undefined => usePierreWorkerPool();
