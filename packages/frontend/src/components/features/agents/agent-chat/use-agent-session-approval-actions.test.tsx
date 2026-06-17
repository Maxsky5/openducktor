import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, TEST_EXTERNAL_SESSION_IDS } from "@/test-utils/shared-test-fixtures";
import type { AgentApprovalRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useAgentSessionApprovalActions } from "./use-agent-session-approval-actions";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useAgentSessionApprovalActions>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentSessionApprovalActions, initialProps);

const createApprovalRequest = (requestId: string): AgentApprovalRequest => ({
  requestId,
  requestType: "permission_grant",
  title: "Approve permission: shell",
  summary: "Approval request for shell.",
  affectedPaths: ["*"],
  action: { name: "shell" },
  mutation: "mutating",
  supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
});

const sessionIdentity = (
  externalSessionId: string = TEST_EXTERNAL_SESSION_IDS.default,
): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  sessionIdentity: sessionIdentity(),
  pendingApprovals: [createApprovalRequest("req-1")],
  agentStudioReady: true,
  replyAgentApproval: async () => {},
  ...overrides,
});

describe("useAgentSessionApprovalActions", () => {
  test("does nothing when session is missing or studio is not ready", async () => {
    const replyAgentApproval = mock(async () => {});
    const base = createBaseArgs({ replyAgentApproval });
    const harness = createHookHarness({ ...base, sessionIdentity: null });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyApproval("req-1", "approve_once");
      });

      await harness.update({ ...base, agentStudioReady: false });
      await harness.run(async (state) => {
        await state.onReplyApproval("req-1", "approve_session");
      });

      expect(replyAgentApproval).not.toHaveBeenCalled();
      expect(harness.getLatest().isSubmittingApprovalByRequestId).toEqual({});
      expect(harness.getLatest().approvalReplyErrorByRequestId).toEqual({});
    } finally {
      await harness.unmount();
    }
  });

  test("tracks submitting state while sending an approval reply", async () => {
    const deferredReply = createDeferred<void>();
    const replyAgentApproval = mock(async () => deferredReply.promise);
    const harness = createHookHarness(createBaseArgs({ replyAgentApproval }));

    try {
      await harness.mount();

      await harness.run((state) => {
        void state.onReplyApproval("req-1", "approve_once");
      });

      await harness.waitFor((state) => state.isSubmittingApprovalByRequestId["req-1"] === true);
      expect(replyAgentApproval).toHaveBeenCalledWith(sessionIdentity(), "req-1", "approve_once");

      await harness.run(async () => {
        deferredReply.resolve(undefined);
        await deferredReply.promise;
      });

      await harness.waitFor((state) => state.isSubmittingApprovalByRequestId["req-1"] !== true);
      expect(harness.getLatest().approvalReplyErrorByRequestId["req-1"]).toBeUndefined();
    } finally {
      deferredReply.resolve(undefined);
      await harness.unmount();
    }
  });

  test("stores the thrown Error message when replying fails", async () => {
    const replyAgentApproval = mock(async () => {
      throw new Error("approval denied");
    });
    const harness = createHookHarness(createBaseArgs({ replyAgentApproval }));

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyApproval("req-1", "reject");
      });

      expect(replyAgentApproval).toHaveBeenCalledWith(sessionIdentity(), "req-1", "reject");
      expect(harness.getLatest().approvalReplyErrorByRequestId["req-1"]).toBe("approval denied");
      expect(harness.getLatest().isSubmittingApprovalByRequestId["req-1"]).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });

  test("uses fallback error text for non-Error failures", async () => {
    const replyAgentApproval = mock(async () => {
      throw { code: "E_APPROVAL" };
    });
    const harness = createHookHarness(createBaseArgs({ replyAgentApproval }));

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyApproval("req-1", "approve_session");
      });

      expect(harness.getLatest().approvalReplyErrorByRequestId["req-1"]).toBe(
        "Failed to reply to approval request.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("prunes stale request state when pending approvals change", async () => {
    const replyAgentApproval = mock(async () => {
      throw new Error("stale request");
    });
    const baseArgs = createBaseArgs({ replyAgentApproval });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyApproval("req-1", "reject");
      });
      await harness.waitFor(
        (state) => typeof state.approvalReplyErrorByRequestId["req-1"] === "string",
      );

      await harness.update({
        ...baseArgs,
        pendingApprovals: [createApprovalRequest("req-2")],
      });

      await harness.waitFor((state) => state.approvalReplyErrorByRequestId["req-1"] === undefined);
      expect(harness.getLatest().approvalReplyErrorByRequestId["req-2"]).toBeUndefined();
      expect(harness.getLatest().isSubmittingApprovalByRequestId["req-1"]).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });

  test("clears request state when the session identity changes", async () => {
    const replyAgentApproval = mock(async () => {
      throw new Error("session-bound failure");
    });
    const baseArgs = createBaseArgs({ replyAgentApproval });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyApproval("req-1", "reject");
      });
      await harness.waitFor(
        (state) => typeof state.approvalReplyErrorByRequestId["req-1"] === "string",
      );

      await harness.update({
        ...baseArgs,
        sessionIdentity: sessionIdentity(TEST_EXTERNAL_SESSION_IDS.secondary),
      });

      await harness.waitFor(
        (state) =>
          Object.keys(state.approvalReplyErrorByRequestId).length === 0 &&
          Object.keys(state.isSubmittingApprovalByRequestId).length === 0,
      );
    } finally {
      await harness.unmount();
    }
  });
});
