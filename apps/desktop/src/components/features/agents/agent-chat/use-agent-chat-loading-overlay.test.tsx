import { describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentChatLoadingOverlay } from "./use-agent-chat-loading-overlay";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentChatLoadingOverlay", () => {
  test("keeps the overlay visible until session loading settles", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: true,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(true);

    await harness.update({ sessionId: "session-1", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });

  test("does not re-show the overlay for same-session steady state updates", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(false);

    await harness.update({ sessionId: "session-1", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });

  test("starts a new loading cycle when the selected session changes", async () => {
    const harness = createSharedHookHarness(useAgentChatLoadingOverlay, {
      sessionId: "session-1",
      isSessionViewLoading: false,
    });

    await harness.mount();
    expect(harness.getLatest()).toBe(false);

    await harness.update({ sessionId: "session-2", isSessionViewLoading: true });
    expect(harness.getLatest()).toBe(true);

    await harness.update({ sessionId: "session-2", isSessionViewLoading: false });
    expect(harness.getLatest()).toBe(false);

    await harness.unmount();
  });
});
