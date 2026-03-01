import type { SupportedLanguages } from "@pierre/diffs";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { ReactElement, ReactNode } from "react";
import { workerFactory } from "@/lib/diff/workerFactory";

// ─── Pre-warm config ───────────────────────────────────────────────────────────

/** Common languages to preload for fast initial diff rendering. */
const PRELOAD_LANGS: SupportedLanguages[] = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "markdown",
];

// ─── Provider (wraps the agent studio layout) ──────────────────────────────

/**
 * Mount this provider once on the agents page layout.
 * It uses Pierre's built-in WorkerPoolContextProvider to create and pre-warm
 * Shiki WASM worker pools. PatchDiff / FileDiff components rendered below
 * automatically use the worker pool for off-main-thread syntax highlighting.
 */
export function DiffWorkerProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory,
        poolSize: 2,
        totalASTLRUCacheSize: 56,
      }}
      highlighterOptions={{
        theme: { light: "pierre-light", dark: "pierre-dark" },
        langs: PRELOAD_LANGS,
        lineDiffType: "word-alt",
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
