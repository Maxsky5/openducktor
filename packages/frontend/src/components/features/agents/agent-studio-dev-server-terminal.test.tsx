import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import * as sharedBinding from "@/features/terminals/shared-terminal-binding";
import type { TerminalBinding } from "@/features/terminals/shared-terminal-binding";
import { QueryProvider } from "@/lib/query-provider";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type TerminalBridge,
} from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { AgentStudioDevServerTerminal } from "./agent-studio-dev-server-terminal";

afterEach(() => {
  cleanup();
  mock.restore();
  configureShellBridge(createUnavailableShellBridge());
});

const createHarness = () => {
  let emitFrame: (frame: Uint8Array) => void = () => {};
  const sent: Array<ReturnType<typeof decodeTerminalProtocolFrame>> = [];
  const close = mock(async () => {});
  const bridge: TerminalBridge = {
    connect: mock(async (onFrame, onState) => {
      emitFrame = onFrame;
      onState("connected");
      return {
        close,
        send: async (frame: Uint8Array) => {
          const decoded = decodeTerminalProtocolFrame(frame);
          sent.push(decoded);
          if (decoded.message.type === "attach")
            emit({
              version: TERMINAL_PROTOCOL_VERSION,
              type: "snapshot",
              terminalId: decoded.message.terminalId,
              earliestRetainedSequence: 0,
              snapshotSequenceEnd: 0,
              lifecycle: "running",
              title: "Dev",
              complete: true,
            });
        },
      };
    }),
  };
  const emit = (message: TerminalServerMessage, payload = new Uint8Array()): void => {
    emitFrame(encodeTerminalProtocolFrame({ message, payload }));
  };
  const emulators: Array<{
    writes: Uint8Array[];
    data: (value: string) => void;
    key: (event: KeyboardEvent) => boolean;
    dispose: ReturnType<typeof mock>;
  }> = [];
  const copied: string[] = [];
  spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => {
    copied.push(text);
  });
  const bindingFactory = spyOn(sharedBinding, "createTerminalBinding").mockImplementation(
    (_container, options) => {
      const writes: Uint8Array[] = [];
      const emulator = {
        writes,
        data: (_value: string) => {},
        key: (_event: KeyboardEvent) => true,
        dispose: mock(() => {}),
      };
      const subscription = { dispose: () => {} };
      const binding = {
        terminal: {
          cols: 80,
          rows: 24,
          options,
          write: (bytes: Uint8Array, parsed: () => void) => {
            writes.push(bytes.slice());
            parsed();
          },
          onResize: () => subscription,
          onData: (listener: (data: string) => void) => {
            emulator.data = listener;
            return subscription;
          },
          parser: { registerOscHandler: () => subscription },
          attachCustomKeyEventHandler: (listener: (event: KeyboardEvent) => boolean) => {
            emulator.key = listener;
          },
          hasSelection: () => true,
          getSelection: () => "selected logs",
          reset: () => {},
          resize: () => {},
          scrollToBottom: () => {},
          refresh: () => {},
          focus: () => {},
        },
        fitAddon: { proposeDimensions: () => undefined, fit: () => {} },
        resetLinkState: () => {},
        dispose: emulator.dispose,
      };
      emulators.push(emulator);
      // SAFETY: This native-boundary fixture implements each public binding method used by the viewport.
      return Object.assign(Object.create(null), binding) as TerminalBinding;
    },
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { systemGetPlatform: async () => "darwin" },
      bridge: { terminals: bridge },
    }),
  );
  return { sent, bridge, emit, emulators, bindingFactory, copied, close };
};

describe("dev server terminal viewport", () => {
  test("reports a connection failure directly to the output owner", async () => {
    const harness = createHarness();
    const onError = mock((_message: string | null) => {});
    render(
      <QueryProvider useIsolatedClient>
        <AgentStudioDevServerTerminal terminalId="dev-1" onRendererError={onError} />
      </QueryProvider>,
    );
    await waitFor(() => expect(harness.emulators).toHaveLength(1));
    await act(async () => {
      harness.emit({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "protocol_error",
        failure: { code: "protocol_error", message: "Output transport disconnected." },
      });
    });
    expect(onError).toHaveBeenCalledWith("Output transport disconnected.");
  });

  test("renders live bytes without a metadata update or React commit and keeps output read-only", async () => {
    const harness = createHarness();
    let commits = 0;
    const onError = mock((_message: string | null) => {});
    const view = render(
      <QueryProvider useIsolatedClient>
        <Profiler
          id="output"
          onRender={() => {
            commits += 1;
          }}
        >
          <AgentStudioDevServerTerminal terminalId="dev-1" onRendererError={onError} />
        </Profiler>
      </QueryProvider>,
    );
    await waitFor(() => expect(harness.emulators).toHaveLength(1));
    await waitFor(() =>
      expect(view.getByRole("application").classList.contains("invisible")).toBe(false),
    );
    await act(async () => {
      await Promise.resolve();
    });
    const initialCommits = commits;
    const payload = new TextEncoder().encode(
      "\u001b[?1049hNx live output 😀\r\n\u001b[?1049lready\r\n",
    );
    await act(async () => {
      for (let index = 0; index < payload.length; index += 1)
        harness.emit(
          {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "output",
            terminalId: "dev-1",
            sequenceStart: index,
            sequenceEnd: index + 1,
            replay: false,
          },
          payload.subarray(index, index + 1),
        );
      await Promise.resolve();
    });
    const emulator = harness.emulators[0];
    if (!emulator) throw new Error("Expected a mounted output terminal.");
    expect(new Uint8Array(emulator.writes.flatMap((bytes) => [...bytes]))).toEqual(payload);
    expect(commits).toBe(initialCommits);
    expect(harness.bindingFactory.mock.calls[0]?.[1]).toMatchObject({
      disableStdin: true,
      convertEol: true,
    });
    emulator.data("should not reach the process");
    await act(async () => {
      emulator.key(new KeyboardEvent("keydown", { key: "c", metaKey: true }));
      await Promise.resolve();
    });
    expect(harness.copied).toEqual(["selected logs"]);
    expect(harness.sent.some((frame) => frame.message.type === "input")).toBe(false);
    await waitFor(() =>
      expect(harness.sent.at(-1)?.message).toMatchObject({
        type: "ack",
        sequenceEnd: payload.byteLength,
      }),
    );
    view.unmount();
    expect(emulator.dispose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(harness.close).toHaveBeenCalledTimes(1));
  });

  test("starts a replacement terminal at its own byte boundary and ignores detached output", async () => {
    const harness = createHarness();
    const onError = mock((_message: string | null) => {});
    const ui = (terminalId: string) => (
      <QueryProvider useIsolatedClient>
        <AgentStudioDevServerTerminal terminalId={terminalId} onRendererError={onError} />
      </QueryProvider>
    );
    const view = render(ui("old-run"));
    await waitFor(() => expect(harness.emulators).toHaveLength(1));
    view.rerender(ui("new-run"));
    await waitFor(() => expect(harness.emulators).toHaveLength(2));
    await act(async () => {
      for (const terminalId of ["old-run", "new-run"])
        harness.emit(
          {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "output",
            terminalId,
            sequenceStart: 0,
            sequenceEnd: 3,
            replay: false,
          },
          new TextEncoder().encode("new"),
        );
      await Promise.resolve();
    });
    expect(harness.emulators[0]?.writes).toEqual([]);
    expect(harness.emulators[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.emulators[1]?.writes).toEqual([new TextEncoder().encode("new")]);
    expect(harness.bridge.connect).toHaveBeenCalledTimes(1);
    expect(
      harness.sent
        .filter((frame) => frame.message.type === "attach")
        .map((frame) => frame.message.terminalId),
    ).toEqual(["old-run", "new-run"]);
    view.unmount();
  });
});
