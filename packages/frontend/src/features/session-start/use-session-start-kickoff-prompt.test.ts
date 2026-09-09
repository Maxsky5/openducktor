import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useSessionStartKickoffPrompt } from "./use-session-start-kickoff-prompt";

type PromptRequest = Parameters<typeof useSessionStartKickoffPrompt>[0];

const deferred = () => {
  let resolve!: (text: string) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("useSessionStartKickoffPrompt", () => {
  test("requires a new result when an earlier branch is selected again", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const resolve = mock()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const input: PromptRequest = {
      requestId: "request-1",
      resolveKickoffPrompt: resolve,
      selectedTargetBranch: "refs/heads/main",
    };
    const harness = createHookHarness(useSessionStartKickoffPrompt, input);
    await harness.mount();
    try {
      await harness.run(() => first.resolve("old main"));
      expect(harness.getLatest().kickoffPrompt).toBe("old main");
      await harness.update({ ...input, selectedTargetBranch: "refs/heads/other" });
      await harness.update(input);
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      expect(harness.getLatest().kickoffPrompt).toBeUndefined();
      await harness.run(() => second.reject(new Error("stale other")));
      expect(harness.getLatest().kickoffPromptError).toBeNull();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      await harness.run(() => third.resolve("  refreshed main\n"));
      expect(harness.getLatest().kickoffPrompt).toBe("  refreshed main\n");
      expect(harness.getLatest().isKickoffPromptLoading).toBe(false);
      expect(resolve.mock.calls).toEqual([
        [{ branch: "main" }],
        [{ branch: "other" }],
        [{ branch: "main" }],
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps errors visible until explicit retry and preserves exact retry text", async () => {
    const retry = deferred();
    const resolve = mock()
      .mockRejectedValueOnce(new Error("Prompt settings unavailable"))
      .mockReturnValueOnce(retry.promise);
    const harness = createHookHarness(useSessionStartKickoffPrompt, {
      requestId: "request-1",
      resolveKickoffPrompt: resolve,
      selectedTargetBranch: "refs/remotes/origin/main",
    });
    await harness.mount();
    try {
      expect(harness.getLatest().kickoffPromptError).toBe("Prompt settings unavailable");
      expect(harness.getLatest().isKickoffPromptLoading).toBe(false);
      expect(resolve).toHaveBeenCalledTimes(1);
      await harness.run((state) => state.onRetryKickoffPrompt());
      expect(harness.getLatest().kickoffPromptError).toBeNull();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      await harness.run(() => retry.resolve("\n  exact {task.title}  \n"));
      expect(harness.getLatest().kickoffPrompt).toBe("\n  exact {task.title}  \n");
      expect(harness.getLatest().isKickoffPromptLoading).toBe(false);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(resolve).toHaveBeenLastCalledWith({ branch: "main", remote: "origin" });
    } finally {
      await harness.unmount();
    }
  });

  test("hides replaced resolver results and ignores completion after closing", async () => {
    const pending = deferred();
    const replacement = deferred();
    const input: PromptRequest = {
      requestId: "request-1",
      resolveKickoffPrompt: async () => "first resolver",
      selectedTargetBranch: "",
    };
    const harness = createHookHarness(useSessionStartKickoffPrompt, input);
    await harness.mount();
    try {
      expect(harness.getLatest().kickoffPrompt).toBe("first resolver");
      await harness.update({ ...input, resolveKickoffPrompt: () => pending.promise });
      expect(harness.getLatest().kickoffPrompt).toBeUndefined();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      await harness.update({ ...input, requestId: undefined, resolveKickoffPrompt: undefined });
      await harness.run(() => pending.resolve("closed request"));
      expect(harness.getLatest().kickoffPrompt).toBeUndefined();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(false);
      await harness.update({
        ...input,
        requestId: "request-2",
        resolveKickoffPrompt: () => replacement.promise,
      });
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      await harness.run(() => replacement.resolve("replacement"));
      expect(harness.getLatest().kickoffPrompt).toBe("replacement");
    } finally {
      await harness.unmount();
    }
  });
});
