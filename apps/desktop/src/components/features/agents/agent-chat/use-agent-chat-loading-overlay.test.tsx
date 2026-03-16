import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useAgentChatLoadingOverlay } from "./use-agent-chat-loading-overlay";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type OverlayHookProps = {
  sessionId: string | null;
  isSessionViewLoading: boolean;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useAgentChatLoadingOverlay", () => {
  test("keeps the overlay visible until session loading settles", async () => {
    const latestVisibleRef: { current: boolean | null } = { current: null };

    const Harness = (props: OverlayHookProps): null => {
      latestVisibleRef.current = useAgentChatLoadingOverlay(props);
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, {
          sessionId: "session-1",
          isSessionViewLoading: true,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(true);

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          sessionId: "session-1",
          isSessionViewLoading: false,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(false);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("does not re-show the overlay for same-session steady state updates", async () => {
    const latestVisibleRef: { current: boolean | null } = { current: null };

    const Harness = (props: OverlayHookProps): null => {
      latestVisibleRef.current = useAgentChatLoadingOverlay(props);
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, {
          sessionId: "session-1",
          isSessionViewLoading: false,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(false);

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          sessionId: "session-1",
          isSessionViewLoading: false,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(false);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("starts a new loading cycle when the selected session changes", async () => {
    const latestVisibleRef: { current: boolean | null } = { current: null };

    const Harness = (props: OverlayHookProps): null => {
      latestVisibleRef.current = useAgentChatLoadingOverlay(props);
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, {
          sessionId: "session-1",
          isSessionViewLoading: false,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(false);

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          sessionId: "session-2",
          isSessionViewLoading: true,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(true);

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          sessionId: "session-2",
          isSessionViewLoading: false,
        }),
      );
      await flush();
    });

    expect(latestVisibleRef.current).toBe(false);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });
});
