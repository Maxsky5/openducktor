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

const createQueuedWriteTerminalHarness = (queuedData: string) => {
  const open = mock((_container: HTMLElement) => {});
  const loadAddon = mock((_addon: unknown) => {});
  const fit = mock(() => {});
  let screen = "";
  const queuedWrites: Array<() => void> = [];
  const createTerminalBinding = (container: HTMLElement) => {
    let active = true;
    const reset = mock(() => {
      if (active) {
        screen = "";
      }
    });
    const clear = mock(() => {
      if (active) {
        screen = "";
      }
    });
    const dispose = mock(() => {
      active = false;
    });
    const write = mock((data: string, callback?: () => void) => {
      if (data === queuedData) {
        queuedWrites.push(() => {
          if (active) {
            screen += data;
          }
          callback?.();
        });
        return;
      }

      if (active) {
        screen += data;
      }
      callback?.();
    });
    open(container);
    loadAddon({});
    return {
      terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
      fitAddon: { dispose: mock(() => {}), fit },
    };
  };

  return {
    createTerminalBinding,
    queuedWrites,
    readScreen: () => screen,
  };
};

describe("AgentStudioDevServerTerminal", () => {
  test("creates a read-only terminal and replays buffered chunks", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const clear = mock(() => {});
    const writes: string[] = [];
    const write = mock((data: string, callback?: () => void) => {
      writes.push(data);
      callback?.();
    });
    const dispose = mock(() => {});
    const onRendererError = mock(() => {});
    let capturedOptions: { disableStdin?: boolean; fontFamily?: string } = {};
    const createTerminalBinding = (
      container: HTMLElement,
      options: { disableStdin?: boolean; fontFamily?: string },
    ) => {
      capturedOptions = options;
      open(container);
      loadAddon({});
      return {
        terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
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
    expect(capturedOptions.disableStdin).toBe(true);
    expect(capturedOptions.fontFamily).toContain('"Symbols Nerd Font Mono"');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(["ready\r\n"]);
    expect(onRendererError).toHaveBeenCalledWith(null);
  });

  test("appends only new chunks until a reset token forces replay", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const clear = mock(() => {});
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
        terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
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
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "first\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
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
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
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

  test("continues rendering live chunks when an incremental write callback stalls", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const clear = mock(() => {});
    const writes: string[] = [];
    let screen = "";
    const write = mock((data: string, callback?: () => void) => {
      writes.push(data);
      screen += data;
      if (data === "stalled\r\n") {
        return;
      }

      callback?.();
    });
    const dispose = mock(() => {});
    const onRendererError = () => {};
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
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
      expect(screen).toBe("ready\r\n");
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 1,
              data: "stalled\r\n",
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
      expect(screen).toBe("ready\r\nstalled\r\n");
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 1,
              data: "stalled\r\n",
              timestamp: "2026-03-19T15:30:01.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 2,
              data: "still live\r\n",
              timestamp: "2026-03-19T15:30:02.000Z",
            },
          ],
          lastSequence: 2,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(screen).toBe("ready\r\nstalled\r\nstill live\r\n");
    });
    expect(writes).toEqual(["ready\r\n", "stalled\r\n", "still live\r\n"]);
  });

  test("clears stale terminal rows before replaying a reset window", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    let screen = "";
    const reset = mock(() => {});
    const clear = mock(() => {
      screen = "";
    });
    const write = mock((data: string, callback?: () => void) => {
      screen += data;
      callback?.();
    });
    const dispose = mock(() => {});
    const onRendererError = () => {};
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "old failed output\r\n",
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
      expect(screen).toBe("old failed output\r\n");
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "Starting `cd apps/web && pnpm dev`\r\n",
              timestamp: "2026-03-19T15:31:00.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 1,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(screen).toBe("Starting `cd apps/web && pnpm dev`\r\n");
    });
    expect(clear).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  test("replays from scratch when the task scope changes with the same script id", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    let screen = "";
    const reset = mock(() => {
      screen = "";
    });
    const clear = mock(() => {
      screen = "";
    });
    const write = mock((data: string, callback?: () => void) => {
      screen += data;
      callback?.();
    });
    const dispose = mock(() => {});
    const onRendererError = () => {};
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 7,
              data: "task one output\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
          lastSequence: 7,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(screen).toBe("task one output\r\n");
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-2"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "task two output\r\n",
              timestamp: "2026-03-19T15:31:00.000Z",
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
      expect(screen).toBe("task two output\r\n");
    });
    expect(reset).toHaveBeenCalledTimes(2);
  });

  test("preserves split ANSI sequences across replay and incremental writes", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const clear = mock(() => {
      screen = "";
    });
    const writes: string[] = [];
    let screen = "";
    const write = mock((data: string, callback?: () => void) => {
      writes.push(data);
      screen += data;
      callback?.();
    });
    const dispose = mock(() => {});
    const onRendererError = () => {};
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: {
          clear,
          dispose,
          loadAddon,
          open,
          options: {},
          reset: () => {
            screen = "";
            reset();
          },
          write,
        },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "\u001b[38;2;255;0",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 1,
              data: ";0mready",
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
      expect(screen).toBe("\u001b[38;2;255;0;0mready");
    });
    expect(writes).toEqual(["\u001b[38;2;255;0;0mready"]);

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "\u001b[38;2;255;0",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 1,
              data: ";0mready",
              timestamp: "2026-03-19T15:30:01.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 2,
              data: "\u001b[0m\r\n",
              timestamp: "2026-03-19T15:30:02.000Z",
            },
          ],
          lastSequence: 2,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(screen).toBe("\u001b[38;2;255;0;0mready\u001b[0m\r\n");
    });
    expect(writes).toEqual(["\u001b[38;2;255;0;0mready", "\u001b[0m\r\n"]);

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "\u001b[38;2;255;0;0mready\u001b[0m\r\n",
              timestamp: "2026-03-19T15:30:03.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 1,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(screen).toBe("\u001b[38;2;255;0;0mready\u001b[0m\r\n");
    });
    expect(writes).toEqual([
      "\u001b[38;2;255;0;0mready",
      "\u001b[0m\r\n",
      "\u001b[38;2;255;0;0mready\u001b[0m\r\n",
    ]);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  test("drops queued replay writes when switching scripts", async () => {
    const onRendererError = () => {};
    const terminalHarness = createQueuedWriteTerminalHarness("frontend\r\n");

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "frontend\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={terminalHarness.createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(terminalHarness.queuedWrites).toHaveLength(1);
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="backend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "backend",
              runIdentity: {
                runId: "backend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "backend\r\n",
              timestamp: "2026-03-19T15:30:01.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={terminalHarness.createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(terminalHarness.readScreen()).toBe("backend\r\n");
    });

    terminalHarness.queuedWrites[0]?.();
    expect(terminalHarness.readScreen()).toBe("backend\r\n");
  });

  test("drops queued incremental writes when switching scripts", async () => {
    const onRendererError = () => {};
    const terminalHarness = createQueuedWriteTerminalHarness("stale frontend\r\n");

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "frontend ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={terminalHarness.createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(terminalHarness.readScreen()).toBe("frontend ready\r\n");
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "frontend ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 1,
              data: "stale frontend\r\n",
              timestamp: "2026-03-19T15:30:01.000Z",
            },
          ],
          lastSequence: 1,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={terminalHarness.createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(terminalHarness.queuedWrites).toHaveLength(1);
    });

    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="backend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "backend",
              runIdentity: {
                runId: "backend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "backend ready\r\n",
              timestamp: "2026-03-19T15:30:02.000Z",
            },
          ],
          lastSequence: 0,
          resetToken: 0,
        }}
        onRendererError={onRendererError}
        createTerminalBinding={terminalHarness.createTerminalBinding}
      />,
    );

    await waitFor(() => {
      expect(terminalHarness.readScreen()).toBe("backend ready\r\n");
    });

    terminalHarness.queuedWrites[0]?.();
    expect(terminalHarness.readScreen()).toBe("backend ready\r\n");
  });

  test("surfaces renderer initialization failures", async () => {
    const onRendererError = mock(() => {});

    render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
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

  test("surfaces renderer update failures", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const clear = mock(() => {});
    const dispose = mock(() => {});
    const onRendererError = mock(() => {});
    let shouldThrow = false;
    const write = mock((data: string, callback?: () => void) => {
      if (shouldThrow && data === "broken\r\n") {
        throw new Error("write failed");
      }

      callback?.();
    });
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: { clear, dispose, loadAddon, open, options: {}, reset, write },
        fitAddon: { dispose, fit },
      };
    };

    const view = render(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
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

    shouldThrow = true;
    view.rerender(
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-1"
        scriptId="frontend"
        terminalBuffer={{
          entries: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 1,
              data: "broken\r\n",
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
      expect(onRendererError).toHaveBeenCalledWith(
        "Failed to render dev server terminal: write failed",
      );
    });
  });

  test("copies terminal selection on keyboard copy shortcut", async () => {
    const open = mock((_container: HTMLElement) => {});
    const loadAddon = mock((_addon: unknown) => {});
    const fit = mock(() => {});
    const reset = mock(() => {});
    const clear = mock(() => {});
    const write = mock((_data: string, callback?: () => void) => {
      callback?.();
    });
    const dispose = mock(() => {});
    const onRendererError = mock(() => {});
    const clipboardWriteText = mock(async (_value: string) => {});
    const originalClipboard = navigator.clipboard;
    let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    const createTerminalBinding = (container: HTMLElement) => {
      open(container);
      loadAddon({});
      return {
        terminal: {
          attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => {
            keyHandler = handler;
          },
          clear,
          dispose,
          getSelection: () => "copied terminal text",
          hasSelection: () => true,
          loadAddon,
          open,
          options: {},
          reset,
          write,
        },
        fitAddon: { dispose, fit },
      };
    };

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });

    try {
      render(
        <AgentStudioDevServerTerminal
          scopeKey="/repo::task-1"
          scriptId="frontend"
          terminalBuffer={{
            entries: [
              {
                scriptId: "frontend",
                runIdentity: {
                  runId: "frontend:1",
                  runOrder: { hostInstanceId: "host-1", generation: 1 },
                },
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
      if (!keyHandler) {
        throw new Error("Expected terminal key handler to be registered");
      }
      const terminalKeyHandler: (event: KeyboardEvent) => boolean = keyHandler;

      const handled = terminalKeyHandler(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "c",
        }),
      );

      expect(handled).toBe(false);
      await waitFor(() => {
        expect(clipboardWriteText).toHaveBeenCalledWith("copied terminal text");
      });
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });
});
