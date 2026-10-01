import { useWorkerPool as usePierreWorkerPool } from "@pierre/diffs/react";

type PierreWorkerPoolManager = NonNullable<ReturnType<typeof usePierreWorkerPool>>;

export type PierreDiffViewerWorkerPool = {
  cleanUpTasks: PierreWorkerPoolManager["cleanUpTasks"];
  getDiffResultCache: PierreWorkerPoolManager["getDiffResultCache"];
  getFileResultCache: PierreWorkerPoolManager["getFileResultCache"];
  highlightDiffAST: PierreWorkerPoolManager["highlightDiffAST"];
  highlightFileAST: PierreWorkerPoolManager["highlightFileAST"];
  isWorkingPool: PierreWorkerPoolManager["isWorkingPool"];
  primeDiffHighlightCache: PierreWorkerPoolManager["primeDiffHighlightCache"];
  subscribeToStatChanges: (callback: () => void) => () => void;
};

export const useWorkerPool = (): PierreDiffViewerWorkerPool | undefined => usePierreWorkerPool();
