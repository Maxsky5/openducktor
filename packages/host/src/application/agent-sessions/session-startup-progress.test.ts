import { describe, expect, test } from "bun:test";
import type { StartupOperationSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createStartupProgressRecorder,
  CurrentStartupProgress,
  startupStep,
} from "./session-startup-progress";

const createRecorder = () => {
  const published: StartupOperationSnapshot[] = [];
  const recorder = createStartupProgressRecorder(
    {
      context: { startupAttemptId: "attempt-1", operationId: "op-1" },
      hostInstanceId: "host-1",
      workspaceId: "workspace-1",
      repoPath: "/repo",
      scope: { kind: "workspace", draftId: "draft-1" },
    },
    (snapshot) => {
      published.push(snapshot);
    },
    (ref) =>
      Effect.succeed({
        ref,
        runtimeId: "runtime-1",
        liveStateSequence: 0,
      }),
    () => Effect.void,
  );
  return { recorder, published };
};

describe("session-startup-progress", () => {
  test("plan skips identical snapshots and preserves running or completed steps", () => {
    const { recorder, published } = createRecorder();
    const planned = [
      { id: "checkout", label: "Create workspace worktree", state: "pending" as const },
      { id: "action:setup", label: "Worktree setup", state: "pending" as const },
    ];

    recorder.plan(planned);
    expect(published).toHaveLength(1);

    // Identical re-plan publishes no duplicate snapshot.
    recorder.plan(planned);
    expect(published).toHaveLength(1);

    recorder.step({
      id: "checkout",
      label: "Create workspace worktree",
      state: "completed",
      details: ["/repo/wt"],
    });
    expect(published).toHaveLength(2);

    // Re-planning with pending steps must not regress completed steps back to pending.
    recorder.plan(planned);
    expect(published).toHaveLength(2);
    expect(recorder.snapshot().steps[0]?.state).toBe("completed");
    expect(recorder.snapshot().steps[0]?.details).toEqual(["/repo/wt"]);
  });

  test("startupStep merges onSuccess fields into the single completed snapshot", async () => {
    const { recorder, published } = createRecorder();

    const value = await Effect.runPromise(
      startupStep(
        { id: "naming", label: "Choose branch name" },
        Effect.succeed({ branch: "odt/demo", notice: "Fallback used." }),
        (result) => ({
          details: [result.branch, result.notice],
          warning: result.notice,
        }),
      ).pipe(Effect.provideService(CurrentStartupProgress, recorder)),
    );

    expect(value.branch).toBe("odt/demo");
    expect(published).toHaveLength(2);
    expect(published[0]?.steps[0]?.state).toBe("running");
    expect(published[1]?.steps[0]).toMatchObject({
      id: "naming",
      state: "completed",
      details: ["odt/demo", "Fallback used."],
      warning: "Fallback used.",
    });
  });
});
