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

test("detaches a hidden terminal and catches it up when it shows again", async () => {
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
      expect(view.getByRole("application").classList.contains("invisible")).toBe(false);
    });
    const screen = view.container.querySelector(".xterm-screen");
    expect(view.container.querySelectorAll(".xterm-screen")).toHaveLength(1);

    view.rerender(content(false));
    expect(view.container.querySelector(".xterm-screen") === screen).toBe(true);
    await waitFor(() => expect(sentTypes).toContain("detach"));

    const payload = new TextEncoder().encode("output after the reveal");
    const sendOutput = () =>
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
    // A hidden terminal takes no output, so it parses and acknowledges nothing.
    await act(async () => sendOutput());
    expect(sentTypes).not.toContain("ack");

    view.rerender(content(true));
    await waitFor(() => expect(sentTypes).toEqual(["attach", "detach", "attach"]));
    await act(async () => sendOutput());
    await waitFor(() => expect(sentTypes).toContain("ack"));
    expect(view.container.querySelector(".xterm-screen") === screen).toBe(true);
    expect(view.container.contains(document.activeElement)).toBe(false);
  } finally {
    view.unmount();
    await controller.dispose();
    await connection.dispose();
  }
});
