import { describe, expect, spyOn, test } from "bun:test";
import { disposeHighlighter, getHighlighterIfLoaded } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { renderHook } from "@testing-library/react";
import * as workerModule from "@/lib/diff/workerFactory";
import { restoreAfterTestBody } from "@/test-utils/restore-after-test-body";
import { DiffWorkerProvider } from "./DiffWorkerProvider";

describe("DiffWorkerProvider", () => {
  // This test starts a real worker and loads its WebAssembly module.
  test("uses Highlights on the page and renders file tokens in the worker pool", async () => {
    const workerFactorySpy = spyOn(workerModule, "workerFactory").mockImplementation(
      () => new Worker(import.meta.resolve("@pierre/diffs/worker/worker-portable.js")),
    );
    let unmount: (() => void) | undefined;
    const finishTest = restoreAfterTestBody(() => {
      unmount?.();
      workerFactorySpy.mockRestore();
    });
    try {
      const view = renderHook(useWorkerPool, { wrapper: DiffWorkerProvider });
      unmount = view.unmount;
      const pool = view.result.current;
      if (!pool) throw new Error("The diff worker pool is missing");

      const file = {
        name: "sample.ts",
        contents: "export const label = 'café';",
        cacheKey: "sample.ts",
      };
      await pool.primeFileHighlightCache(file);

      expect(pool.getPreferredHighlighter()).toBe("highlights");
      expect(getHighlighterIfLoaded()?.name).toBe("highlights");
      const line = pool.getFileResultCache(file)?.result.code[0];
      const tokens = line?.type === "element" ? line.children : [];
      const tokenStyles = tokens.flatMap((token) =>
        token.type === "element" && token.properties.style ? [token.properties.style] : [],
      );
      expect(new Set(tokenStyles).size).toBeGreaterThan(1);

      // The pinned Highlights release renders CUE as plain text.
      const cue = {
        name: "sample.cue",
        contents: 'label: "café"',
        cacheKey: "sample.cue",
      };
      await pool.primeFileHighlightCache(cue);
      expect(pool.getFileResultCache(cue)?.result.code[0]).toMatchObject({
        children: [{ children: [{ type: "text", value: cue.contents }] }],
      });
    } finally {
      finishTest();
      await disposeHighlighter();
    }
  }, 5000);
});
