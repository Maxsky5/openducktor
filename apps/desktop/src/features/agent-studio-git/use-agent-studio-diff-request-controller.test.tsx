import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { useAgentStudioDiffRequestController } from "./use-agent-studio-diff-request-controller";

type HookResult = ReturnType<typeof useAgentStudioDiffRequestController>;

const createHarness = () => {
  const latestResultRef: { current: HookResult | null } = { current: null };

  function Harness(): null {
    latestResultRef.current = useAgentStudioDiffRequestController();
    return null;
  }

  let renderer = null as ReturnType<typeof create> | null;
  act(() => {
    renderer = create(createElement(Harness));
  });

  const getResult = (): HookResult => {
    if (!latestResultRef.current) {
      throw new Error("Expected diff request controller result");
    }
    return latestResultRef.current;
  };

  return {
    getResult,
    unmount: () => renderer?.unmount(),
  };
};

describe("useAgentStudioDiffRequestController", () => {
  const mountedHarnesses = new Set<ReturnType<typeof createHarness>>();

  afterEach(() => {
    for (const harness of mountedHarnesses) {
      harness.unmount();
    }
    mountedHarnesses.clear();
  });

  test("invalidates prior request versions when request tracking resets", () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);

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

    act(() => {
      controller.resetRequestTracking();
    });

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
