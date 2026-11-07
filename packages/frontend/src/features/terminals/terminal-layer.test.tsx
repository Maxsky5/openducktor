import { expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import { createTerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/use-terminals";
import { act, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs } from "@/components/ui/tabs";
import { QueryProvider } from "@/test-utils/query-provider";
import { createTerminalSessionsFixture } from "@/test-utils/session-panel-fixtures";
import { TerminalLayer, TerminalStatusMessages } from "./terminal-layer";

// Load the lazy viewport before the test timeout starts.
await import("./terminal-viewport");

test("offers Retry and Dismiss for a discovery failure and Dismiss for a transport failure", () => {
  const markup = renderToStaticMarkup(
    <TerminalStatusMessages
      terminals={{
        discoveryNotice: "The host did not answer.",
        onDismissDiscoveryError: () => {},
        transportNotice: "Socket closed.",
        onDismissTransportError: () => {},
        isLoading: false,
        onRetryDiscovery: () => {},
      }}
    />,
  );
  expect(markup).toContain("Retry terminal discovery");
  expect(markup).toContain('aria-label="Dismiss terminal discovery error"');
  expect(markup).toContain('aria-label="Dismiss terminal transport error"');
});

test("keeps a shown read-only terminal accessible and suspends only its hidden accessibility tree", async () => {
  const terminalId = "read-only-terminal";
  const tab: TerminalTab = {
    tabId: terminalId,
    terminalId,
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
    summary: {
      terminalId,
      label: "Shell",
      context: { workspaceId: "workspace", repoPath: "/repo", taskId: "task" },
      initialWorkingDir: "/repo",
      createdAt: "2026-11-07T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
      startedBy: "user",
    },
  };
  const sentTypes: string[] = [];
  let receive: (frame: Uint8Array) => void = () => {
    throw new Error("The terminal transport has not connected.");
  };
  const controller = createTerminalTransportController(
    {
      connect: async (onFrame) => {
        receive = onFrame;
        return {
          send: async (frame) => {
            const { message } = decodeTerminalProtocolFrame(frame);
            sentTypes.push(message.type);
            if (message.type === "attach") {
              onFrame(
                encodeTerminalProtocolFrame({
                  message: {
                    version: TERMINAL_PROTOCOL_VERSION,
                    type: "snapshot",
                    terminalId,
                    earliestRetainedSequence: 0,
                    snapshotSequenceEnd: 0,
                    lifecycle: "running",
                    title: "Shell",
                    complete: true,
                  },
                  payload: new Uint8Array(),
                }),
              );
            }
          },
          close: () => {},
        };
      },
    },
    () => {},
  );
  const connection = createTestClientConnection({ scheduleTask: () => () => {} });
  const terminals = createTerminalSessionsFixture({ scopeKey: "task", controller });
  const mounts = [{ key: terminalId, scopeKey: "task", tab, value: tab.tabId }];
  const content = (isVisible: boolean) => (
    <QueryProvider connection={connection}>
      <Tabs value={tab.tabId}>
        <TerminalLayer
          terminals={terminals}
          mounts={mounts}
          activeKey={terminalId}
          isVisible={isVisible}
          isInteractive={false}
          focusRequest={0}
          tabIdBase="terminal-test"
        />
      </Tabs>
    </QueryProvider>
  );
  await controller.connect();
  const view = render(content(true));
  try {
    await waitFor(() => {
      expect(view.container.querySelectorAll(".xterm-accessibility")).toHaveLength(1);
      expect(view.getByRole("application").classList.contains("invisible")).toBe(false);
    });
    const screen = view.container.querySelector(".xterm-screen");
    expect(view.container.querySelectorAll(".xterm-screen")).toHaveLength(1);

    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
      try {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(view.container.querySelectorAll(".xterm-accessibility")).toHaveLength(0);
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(view.container.querySelectorAll(".xterm-accessibility")).toHaveLength(1);
      } finally {
        if (descriptor) Object.defineProperty(document, "visibilityState", descriptor);
        else Reflect.deleteProperty(document, "visibilityState");
        document.dispatchEvent(new Event("visibilitychange"));
      }
    });
    expect(view.container.querySelector(".xterm-screen") === screen).toBe(true);

    view.rerender(content(false));
    expect(view.container.querySelectorAll(".xterm-accessibility")).toHaveLength(0);
    expect(view.container.querySelector(".xterm-screen") === screen).toBe(true);

    const payload = new TextEncoder().encode("output received while hidden");
    await act(async () => {
      receive(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "output",
            terminalId,
            sequenceStart: 0,
            sequenceEnd: payload.byteLength,
            replay: false,
          },
          payload,
        }),
      );
    });
    await waitFor(() => expect(sentTypes).toContain("ack"));
    expect(view.container.querySelectorAll(".xterm-accessibility")).toHaveLength(0);

    view.rerender(content(true));
    await waitFor(() =>
      expect(view.container.querySelector(".xterm-accessibility-tree")?.textContent).toContain(
        "output received while hidden",
      ),
    );
    expect(view.container.querySelector(".xterm-screen") === screen).toBe(true);
    expect(sentTypes.filter((type) => type === "attach")).toHaveLength(1);
    expect(sentTypes).not.toContain("detach");
    expect(view.container.contains(document.activeElement)).toBe(false);
  } finally {
    view.unmount();
    await controller.dispose();
    await connection.dispose();
  }
  // Restored xterm accessibility rows use a native one-second debounce.
}, 3_000);
