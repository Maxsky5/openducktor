import { afterEach, describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentStudioDiffRequestController } from "./use-diff-request-controller";

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

const unmountHarnesses = async (
  harnesses: Iterable<ReturnType<typeof createHarness>>,
): Promise<void> => {
  await Promise.all(Array.from(harnesses, (harness) => harness.unmount()));
};

const expectBegin = (
  result: ReturnType<HookResult["beginRequest"]>,
): Extract<ReturnType<HookResult["beginRequest"]>, { kind: "begin" }> => {
  if (result.kind !== "begin") {
    throw new Error("Expected request to begin");
  }
  return result;
};

describe("useAgentStudioDiffRequestController", () => {
  const mountedHarnesses = new Set<ReturnType<typeof createHarness>>();

  afterEach(async () => {
    await unmountHarnesses(mountedHarnesses);
    mountedHarnesses.clear();
  });

  test("invalidates prior request versions when request tracking resets", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    const initialRequest = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: true,
        replayIfInFlight: false,
        force: false,
      }),
    );

    controller.resetRequestTracking();

    expect(controller.shouldApplyResult("target", "full", initialRequest.version)).toBe(false);

    const nextRequest = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: true,
        replayIfInFlight: false,
        force: true,
      }),
    );

    expect(nextRequest.version).toBeGreaterThan(initialRequest.version);
    expect(controller.shouldApplyResult("target", "full", nextRequest.version)).toBe(true);
  });

  test("allows concurrent full requests for different scopes", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    const targetRequest = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );
    const uncommittedRequest = expectBegin(
      controller.beginRequest({
        scope: "uncommitted",
        mode: "full",
        requestKey: "repo::uncommitted::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );

    expect(controller.shouldApplyResult("target", "full", targetRequest.version)).toBe(true);
    expect(controller.shouldApplyResult("uncommitted", "full", uncommittedRequest.version)).toBe(
      true,
    );
    expect(uncommittedRequest.requestSequence).toBeGreaterThan(targetRequest.requestSequence);
  });

  test("does not clear in-flight tracking when finishRequest receives a mismatched key", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    const request = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: true,
        replayIfInFlight: false,
        force: false,
      }),
    );

    const mismatchedFinish = controller.finishRequest({
      scope: "target",
      mode: "full",
      requestKey: "repo::target::worktree-b",
      requestSequence: request.requestSequence,
      showLoading: true,
    });
    expect(mismatchedFinish.replayFullLoad).toBeNull();

    expect(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    ).toEqual({ kind: "skip" });

    controller.finishRequest({
      scope: "target",
      mode: "full",
      requestKey: "repo::target::worktree-a",
      requestSequence: request.requestSequence,
      showLoading: false,
    });

    expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );
  });

  test("skips same-key summary requests while a full request is in flight", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    expectBegin(
      controller.beginRequest({
        scope: "uncommitted",
        mode: "full",
        requestKey: "repo::main::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );

    expect(
      controller.beginRequest({
        scope: "uncommitted",
        mode: "summary",
        requestKey: "repo::main::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    ).toEqual({ kind: "skip" });

    expectBegin(
      controller.beginRequest({
        scope: "uncommitted",
        mode: "summary",
        requestKey: "repo::main::worktree-b",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );
  });

  test("rejects stale versions across rapid begin reset begin sequences", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    const staleRequest = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "summary",
        requestKey: "repo::main::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );

    controller.resetRequestTracking();

    const currentRequest = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "summary",
        requestKey: "repo::main::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );

    expect(controller.shouldApplyResult("target", "summary", staleRequest.version)).toBe(false);
    expect(controller.shouldApplyResult("target", "summary", currentRequest.version)).toBe(true);
    expect(currentRequest.version).toBeGreaterThan(staleRequest.version);
  });

  test("queues one forced full replay while the same full request is in flight", async () => {
    const harness = createHarness();
    mountedHarnesses.add(harness);
    await harness.mount();

    const controller = harness.getResult();
    const request = expectBegin(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: false,
        replayIfInFlight: false,
        force: false,
      }),
    );

    expect(
      controller.beginRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        showLoading: false,
        replayIfInFlight: true,
        force: true,
      }),
    ).toEqual({ kind: "skip" });

    expect(
      controller.finishRequest({
        scope: "target",
        mode: "full",
        requestKey: "repo::target::worktree-a",
        requestSequence: request.requestSequence,
        showLoading: false,
      }),
    ).toEqual({
      clearLoading: false,
      replayFullLoad: { force: true },
    });
  });
});
