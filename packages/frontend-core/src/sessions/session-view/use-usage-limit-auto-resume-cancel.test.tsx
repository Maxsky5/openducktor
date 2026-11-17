import "../../test-support/dom-environment";
import { expect, test } from "bun:test";
import type { UsageLimitAutoResume } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { useUsageLimitAutoResumeCancel } from "./use-usage-limit-auto-resume-cancel";

const planned = (stopId: string): UsageLimitAutoResume => ({
  ref: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree",
    externalSessionId: "session-1",
  },
  stopId,
  resumeAtEpochMs: 1_800_000_000_000,
  state: "scheduled",
});

test("shows a failed cancel for its stop only", async () => {
  const cancels: string[] = [];
  const cancelStop = (stopId: string) => {
    cancels.push(stopId);
    return Promise.reject(new Error("The host is not reachable."));
  };
  const { result, rerender } = renderHook(
    ({ autoResume }) => useUsageLimitAutoResumeCancel(autoResume, cancelStop),
    { initialProps: { autoResume: planned("limit-1") } },
  );

  act(() => result.current.cancel());
  expect(result.current.isCanceling).toBe(true);
  await act(async () => {});
  expect(cancels).toEqual(["limit-1"]);
  expect(result.current.isCanceling).toBe(false);
  expect(result.current.error).toBe("Cancel failed: The host is not reachable.");

  rerender({ autoResume: planned("limit-2") });
  expect(result.current.error).toBeNull();
});
