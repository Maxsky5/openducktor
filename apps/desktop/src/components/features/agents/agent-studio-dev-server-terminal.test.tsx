import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render, waitFor } from "@testing-library/react";
import { AgentStudioDevServerTerminal } from "./agent-studio-dev-server-terminal";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AgentStudioDevServerTerminal", () => {
  test("creates a read-only terminal and replays buffered chunks", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const write = mock(() => {});
    const dispose = mock(() => {});
    const onRendererError = mock(() => {});
    let capturedDisableStdin: boolean | undefined;
    const createTerminalBinding = (container: HTMLElement, options: { disableStdin?: boolean }) => {
      capturedDisableStdin = options.disableStdin;
      open(container);
      loadAddon({});
      return {
        terminal: { dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    render(
      <AgentStudioDevServerTerminal
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              sequence: 0,
              data: "ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
    expect(capturedDisableStdin).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("ready\r\n");
    expect(onRendererError).toHaveBeenCalledWith(null);
  });

  test("appends only new chunks until a reset token forces replay", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const write = mock(() => {});
    const dispose = mock(() => {});
    const onRendererError = () => {};
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: { dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              sequence: 0,
              data: "first\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith("first\r\n");
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              sequence: 0,
              data: "first\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              sequence: 1,
              data: "second\r\n",
              timestamp: "2026-03-19T15:30:01.000Z",
            },
          ],
          lastSequence: 1,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith("second\r\n");
    });
    expect(reset).toHaveBeenCalledTimes(1);

    view.rerender(
      <AgentStudioDevServerTerminal
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              sequence: 4,
              data: "rehydrated\r\n",
              timestamp: "2026-03-19T15:30:02.000Z",
            },
          ],
          lastSequence: 4,
          resetToken: 1,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith("rehydrated\r\n");
    });
    expect(reset).toHaveBeenCalledTimes(2);
  });

  test("surfaces renderer initialization failures", async () => {
    const onRendererError = mock(() => {});

    render(
      <AgentStudioDevServerTerminal
        scriptId="frontend"
        terminalBuffer={null}
        onRendererError={onRendererError}
        createTerminalBinding={() => {
          throw new Error("no terminal backend");
        }}
      />,
    );

    await waitFor(() => {
      expect(onRendererError).toHaveBeenCalledWith(
        "Failed to initialize dev server terminal: no terminal backend",
      );
    });
  });
});
