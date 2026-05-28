import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { enableReactActEnvironment } from "../agent-studio-test-utils";
import { useAgentStudioPullRequestModalModel } from "./use-agent-studio-pull-request-modal-model";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioPullRequestModalModel>[0];

const createPendingPullRequest = (): NonNullable<HookArgs["pendingMergedPullRequest"]> => ({
  taskId: "task-1",
  pullRequest: {
    providerId: "github",
    number: 268,
    url: "https://github.com/Maxsky5/openducktor/pull/268",
    state: "merged",
    createdAt: "2026-03-20T11:00:00Z",
    updatedAt: "2026-03-20T11:21:32Z",
    lastSyncedAt: "2026-03-20T11:21:32Z",
    mergedAt: "2026-03-20T11:21:32Z",
    closedAt: "2026-03-20T11:21:32Z",
  },
});

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  pendingMergedPullRequest: createPendingPullRequest(),
  linkingMergedPullRequestTaskId: null,
  onLinkMergedPullRequest: mock(async () => undefined),
  onCancelLinkMergedPullRequest: mock(() => undefined),
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioPullRequestModalModel, initialProps);

describe("useAgentStudioPullRequestModalModel", () => {
  test("returns no model when no merged pull request is pending", async () => {
    const harness = createHookHarness(createArgs({ pendingMergedPullRequest: null }));

    try {
      await harness.mount();

      expect(harness.getLatest()).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("builds dialog props and dispatches confirm and cancel actions", async () => {
    const pendingMergedPullRequest = createPendingPullRequest();
    const onLinkMergedPullRequest = mock(async () => undefined);
    const onCancelLinkMergedPullRequest = mock(() => undefined);
    const harness = createHookHarness(
      createArgs({
        pendingMergedPullRequest,
        linkingMergedPullRequestTaskId: "task-1",
        onLinkMergedPullRequest,
        onCancelLinkMergedPullRequest,
      }),
    );

    try {
      await harness.mount();

      const model = harness.getLatest();
      expect(model?.pullRequest).toBe(pendingMergedPullRequest.pullRequest);
      expect(model?.isLinking).toBe(true);

      model?.onConfirm();
      model?.onCancel();

      expect(onLinkMergedPullRequest).toHaveBeenCalledTimes(1);
      expect(onCancelLinkMergedPullRequest).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
