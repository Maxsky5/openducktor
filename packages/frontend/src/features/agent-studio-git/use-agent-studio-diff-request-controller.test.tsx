import { afterEach, describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentStudioDiffRequestController } from "./use-agent-studio-diff-request-controller";

type HookResult = ReturnType<typeof useAgentStudioDiffRequestController>;

const createHarness = () => {
  const latestResultRef: { current: HookResult | null } = { current: null };

  const harness = createSharedHookHarness(() => {
    latestResultRef.current = useAgentStudioDiffRequestController();
    return null;
  }, undefined);

  const getResult = (): HookResult => {
    if (!latestResultRef.current) {
      throw new Error("Expected diff request controller result");
    }
    return latestResultRef.current;
  };

  return {
    mount: () => harness.mount(),
    getResult,
    unmount: () => harness.unmount(),
  };
};

describe("useAgentStudioDiffRequestController", () => {
  const mountedHarnesses = new Set<ReturnType<typeof createHarness>>();

  afterEach(async () => {
    for (const harness of mountedHarnesses) {
      await harness.unmount();
    }
    mountedHarnesses.clear();
  });

  test("invalidates prior request versions when request tracking resets", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    const initialRequest = controller.beginRequest({
      scope: "target",
      mode: "full",
      requestKey: "repo::target::worktree-a",
      showLoading: true,
      replayIfInFlight: false,
      force: false,
    });

    if (initialRequest.kind !== "begin") {
      throw new Error("Expected initial full load to begin");
    }

    controller.resetRequestTracking();

    expect(controller.shouldApplyResult("target", "full", initialRequest.version)).toBe(false);

    const nextRequest = controller.beginRequest({
      scope: "target",
      mode: "full",
      requestKey: "repo::target::worktree-a",
      showLoading: true,
      replayIfInFlight: false,
      force: true,
    });

    if (nextRequest.kind !== "begin") {
      throw new Error("Expected post-reset full load to begin");
    }

    expect(nextRequest.version).toBeGreaterThan(initialRequest.version);
    expect(controller.shouldApplyResult("target", "full", nextRequest.version)).toBe(true);
  });
});
