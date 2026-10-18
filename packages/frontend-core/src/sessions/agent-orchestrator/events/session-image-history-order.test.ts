import { expect, test } from "bun:test";
import { createCodexImageSessionHarness } from "./codex-image-session.test-harness";
import { nativeImage, nativeImageTurn } from "./codex-image-runtime.test-fixtures";

for (const terminal of ["failed", "interrupted", "completed", "runtime_failure"] as const) {
  for (const order of ["history-first", "history-pending", "terminal-first"] as const) {
    test(`${terminal} preserves image meaning with ${order} delivery`, async () => {
      const harness = await createCodexImageSessionHarness();
      const runtime = "runtime-live";
      try {
        await harness.startTurn(runtime, "old");
        harness.setHistory(runtime, [
          nativeImageTurn("old", "inProgress", [nativeImage("old-image")]),
        ]);
        const gate = order === "history-pending" ? harness.deferHistory() : null;
        const pending = order !== "terminal-first" ? harness.loadHistory(runtime) : null;
        if (gate) await gate.started;
        else if (pending) await pending;
        if (order === "history-first")
          expect(harness.images(runtime)[0]?.meta).toMatchObject({ status: "running" });
        if (terminal === "runtime_failure") harness.failRuntime(runtime);
        else await harness.endTurn(runtime, "old", terminal);
        const activity = harness.session(runtime).status;
        const approvals = harness.session(runtime).pendingApprovals;
        const questions = harness.session(runtime).pendingQuestions;
        gate?.release();
        if (pending) await pending;
        else await harness.loadHistory(runtime);
        expect(harness.images(runtime)).toHaveLength(1);
        expect(harness.images(runtime)[0]?.meta).toMatchObject({
          itemId: "old-image",
          status: terminal === "interrupted" ? "interrupted" : "incomplete",
        });
        if (terminal !== "interrupted")
          expect(harness.images(runtime)[0]?.meta).toMatchObject({
            incompleteReason: terminal === "completed" ? "turn_ended" : "runtime_failure",
          });
        expect(harness.session(runtime).status).toBe(activity);
        expect(harness.session(runtime).pendingApprovals).toEqual(approvals);
        expect(harness.session(runtime).pendingQuestions).toEqual(questions);
        if (terminal !== "runtime_failure") {
          await harness.startTurn(runtime, "next");
          await harness.image(runtime, "next", "new-image");
          await harness.loadHistory(runtime);
          expect(harness.images(runtime).at(-1)?.meta).toMatchObject({
            status: "running",
            itemId: "new-image",
          });
          await harness.image(runtime, "old", "old-image", "completed");
          expect(harness.images(runtime)[0]?.meta).toMatchObject({ status: "completed" });
        }
      } finally {
        harness.close();
      }
    });
  }
}
