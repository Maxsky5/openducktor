import { describe, expect, mock, test } from "bun:test";
import type { AgentPermissionRequest } from "@/types/agent-orchestrator";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentSessionPermissionActions>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentSessionPermissionActions, initialProps);

const createPermissionRequest = (requestId: string): AgentPermissionRequest => ({
  requestId,
  permission: "shell",
  patterns: ["*"],
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeSessionId: "session-1",
  pendingPermissions: [createPermissionRequest("req-1")],
  agentStudioReady: true,
  replyAgentPermission: async () => {},
  ...overrides,
});

describe("useAgentSessionPermissionActions", () => {
  test("does nothing when session is missing or studio is not ready", async () => {
    const replyAgentPermission = mock(async () => {});
    const base = createBaseArgs({ replyAgentPermission });
    const harness = createHookHarness({ ...base, activeSessionId: null });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyPermission("req-1", "once");
      });

      await harness.update({ ...base, agentStudioReady: false });
      await harness.run(async (state) => {
        await state.onReplyPermission("req-1", "always");
      });

      expect(replyAgentPermission).not.toHaveBeenCalled();
      expect(harness.getLatest().isSubmittingPermissionByRequestId).toEqual({});
      expect(harness.getLatest().permissionReplyErrorByRequestId).toEqual({});
    } finally {
      await harness.unmount();
    }
  });

  test("tracks submitting state while sending a permission reply", async () => {
    const deferredReply = createDeferred<void>();
    const replyAgentPermission = mock(async () => deferredReply.promise);
    const harness = createHookHarness(createBaseArgs({ replyAgentPermission }));

    try {
      await harness.mount();

      await harness.run((state) => {
        void state.onReplyPermission("req-1", "once");
      });

      await harness.waitFor((state) => state.isSubmittingPermissionByRequestId["req-1"] === true);
      expect(replyAgentPermission).toHaveBeenCalledWith("session-1", "req-1", "once");

      await harness.run(async () => {
        deferredReply.resolve(undefined);
        await deferredReply.promise;
      });

      await harness.waitFor((state) => state.isSubmittingPermissionByRequestId["req-1"] !== true);
      expect(harness.getLatest().permissionReplyErrorByRequestId["req-1"]).toBeUndefined();
    } finally {
      deferredReply.resolve(undefined);
      await harness.unmount();
    }
  });

  test("stores the thrown Error message when replying fails", async () => {
    const replyAgentPermission = mock(async () => {
      throw new Error("permission denied");
    });
    const harness = createHookHarness(createBaseArgs({ replyAgentPermission }));

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyPermission("req-1", "reject");
      });

      expect(replyAgentPermission).toHaveBeenCalledWith("session-1", "req-1", "reject");
      expect(harness.getLatest().permissionReplyErrorByRequestId["req-1"]).toBe(
        "permission denied",
      );
      expect(harness.getLatest().isSubmittingPermissionByRequestId["req-1"]).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });

  test("uses fallback error text for non-Error failures", async () => {
    const replyAgentPermission = mock(async () => {
      throw { code: "E_PERMISSION" };
    });
    const harness = createHookHarness(createBaseArgs({ replyAgentPermission }));

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyPermission("req-1", "always");
      });

      expect(harness.getLatest().permissionReplyErrorByRequestId["req-1"]).toBe(
        "Failed to reply to permission request.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("prunes stale request state when pending permissions change", async () => {
    const replyAgentPermission = mock(async () => {
      throw new Error("stale request");
    });
    const baseArgs = createBaseArgs({ replyAgentPermission });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyPermission("req-1", "reject");
      });
      await harness.waitFor(
        (state) => typeof state.permissionReplyErrorByRequestId["req-1"] === "string",
      );

      await harness.update({
        ...baseArgs,
        pendingPermissions: [createPermissionRequest("req-2")],
      });

      await harness.waitFor(
        (state) => state.permissionReplyErrorByRequestId["req-1"] === undefined,
      );
      expect(harness.getLatest().permissionReplyErrorByRequestId["req-2"]).toBeUndefined();
      expect(harness.getLatest().isSubmittingPermissionByRequestId["req-1"]).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });

  test("clears request state when the active session changes", async () => {
    const replyAgentPermission = mock(async () => {
      throw new Error("session-bound failure");
    });
    const baseArgs = createBaseArgs({ replyAgentPermission });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onReplyPermission("req-1", "reject");
      });
      await harness.waitFor(
        (state) => typeof state.permissionReplyErrorByRequestId["req-1"] === "string",
      );

      await harness.update({
        ...baseArgs,
        activeSessionId: "session-2",
      });

      await harness.waitFor(
        (state) =>
          Object.keys(state.permissionReplyErrorByRequestId).length === 0 &&
          Object.keys(state.isSubmittingPermissionByRequestId).length === 0,
      );
    } finally {
      await harness.unmount();
    }
  });
});
