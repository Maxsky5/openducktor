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
    const writes: string[] = [];
    const write = mock((data: string, callback?: () => void) => {
      writes.push(data);
      callback?.();
    });
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
    expect(writes).toEqual(["ready\r\n"]);
    expect(onRendererError).toHaveBeenCalledWith(null);
  });

  test("appends only new chunks until a reset token forces replay", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const writes: string[] = [];
    const write = mock((data: string, callback?: () => void) => {
      writes.push(data);
      callback?.();
    });
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
      expect(writes).toEqual(["first\r\n"]);
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
      expect(writes).toEqual(["first\r\n", "second\r\n"]);
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
      expect(writes).toEqual(["first\r\n", "second\r\n", "rehydrated\r\n"]);
    });
    expect(reset).toHaveBeenCalledTimes(2);
  });

  test("drops stale pending writes when switching scripts", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const dispose = mock(() => {});
    const onRendererError = () => {};
    let screen = "";
    const reset = mock(() => {
      screen = "";
    });
    const write = mock((data: string, callback?: () => void) => {
      const delay = data.includes("frontend") ? 20 : 0;
      setTimeout(() => {
        screen += data;
        callback?.();
      }, delay);
    });
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
              data: "frontend\r\n",
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

    view.rerender(
      <AgentStudioDevServerTerminal
        scriptId="backend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "backend",
              sequence: 0,
              data: "backend\r\n",
              timestamp: "2026-03-19T15:30:01.000Z",
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
      expect(screen).toBe("backend\r\n");
    });
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
