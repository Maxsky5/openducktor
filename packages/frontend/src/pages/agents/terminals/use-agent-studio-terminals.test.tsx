import { describe, expect, test } from "bun:test";
import {
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivityMessage,
  type TerminalSummary,
} from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { act, waitFor } from "@testing-library/react";
import { terminalTabLabel } from "@/features/terminals";
import {
  bottomEntryId,
  bottomTerminalIds,
  createTerminalTestDependencies,
  renderTaskTerminalPanels,
  requireTab,
  selectedBottomTerminal,
  summaryForTask,
  type TerminalTestDependencies,
} from "./agent-studio-terminals-test-harness";

describe("useAgentStudioTerminals", () => {
  test("reloads the task worktree when the task version changes", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let worktreeReads = 0;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        taskWorktreeGet: async () => {
          worktreeReads += 1;
          return worktreeReads === 1 ? null : { workingDirectory: "/repo/worktrees/task-a" };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies, { taskVersion: "version-1" });
    try {
      await waitFor(() => expect(worktreeReads).toBe(1));
      view.update({ taskVersion: "version-2" });
      await waitFor(() => expect(worktreeReads).toBe(2));
    } finally {
      view.unmount();
    }
  });

  test("uses the panel layout owner of the task as the terminal scope", async () => {
    const view = renderTaskTerminalPanels(createTerminalTestDependencies(), {
      workspaceId: "workspace-a",
    });
    try {
      await waitFor(() =>
        expect(view.terminals().scopeKey).toBe(JSON.stringify(["workspace-a", "task", "task-a"])),
      );
      view.update({ workspaceId: "workspace-b" });
      await waitFor(() =>
        expect(view.terminals().scopeKey).toBe(JSON.stringify(["workspace-b", "task", "task-a"])),
      );
    } finally {
      view.unmount();
    }
  });

  test("opens the bottom panel when the host lists existing task terminals", async () => {
    const view = renderTaskTerminalPanels(createTerminalTestDependencies());
    try {
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));
      await waitFor(() => expect(bottomTerminalIds(view.panels())).toEqual(["terminal-task-a"]));
      expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a");
      expect(view.panels().bottom.isVisible).toBe(true);
      expect(view.panels().right.tabs.map((tab) => tab.kind)).toEqual([
        "document",
        "diffs",
        "files",
      ]);
    } finally {
      view.unmount();
    }
  });

  test("opening an empty bottom panel creates and selects a terminal", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const terminals: TerminalSummary[] = [];
    let createCalls = 0;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
        terminalCreate: async ({ context }) => {
          createCalls += 1;
          const terminal: TerminalSummary = {
            ...summaryForTask("taskId" in context ? context.taskId : "unassociated"),
            terminalId: "terminal-created",
          };
          terminals.push(terminal);
          return { ref: { terminalId: terminal.terminalId }, summary: terminal };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => {
        expect(view.terminals().isLoading).toBe(false);
        expect(view.terminals().tabs).toEqual([]);
      });

      act(() => view.panels().bottomToggle.onToggle());

      await waitFor(
        () => {
          expect(createCalls).toBe(1);
          expect(view.panels().bottom.isVisible).toBe(true);
          expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-created");
        },
        { timeout: 2_000 },
      );
    } finally {
      view.unmount();
    }
  });

  test("uses the worktree path while a new terminal is being created", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const create = Promise.withResolvers<{
      ref: { terminalId: string };
      summary: TerminalSummary;
    }>();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
        terminalCreate: async () => create.promise,
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.terminals().startBlockedReason).toBeNull());
      act(() => {
        view.terminals().createTerminal();
      });
      await waitFor(() => expect(view.terminals().tabs[0]?.requestState).toBe("creating"));
      expect(terminalTabLabel(requireTab(view.terminals().tabs[0]))).toBe("/repo/worktrees/task-a");
    } finally {
      create.resolve({
        ref: { terminalId: "terminal-created" },
        summary: { ...summaryForTask("task-a"), terminalId: "terminal-created" },
      });
      view.unmount();
    }
  });

  test("terminates a terminal whose pending creation tab was closed", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const terminals: TerminalSummary[] = [];
    const closeCalls: Array<{ terminalId: string; confirmTerminate: boolean }> = [];
    const create = Promise.withResolvers<{
      ref: { terminalId: string };
      summary: TerminalSummary;
    }>();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
        terminalCreate: async () => {
          const created = await create.promise;
          terminals.push(created.summary);
          return created;
        },
        terminalClose: async (input) => {
          closeCalls.push(input);
          terminals.splice(
            0,
            terminals.length,
            ...terminals.filter((terminal) => terminal.terminalId !== input.terminalId),
          );
          return { closed: true };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.terminals().startBlockedReason).toBeNull());
      act(() => view.panels().bottomToggle.onToggle());
      await waitFor(() => expect(view.terminals().tabs[0]?.requestState).toBe("creating"));
      const pendingEntryId = view.panels().bottom.selectedTabId;
      if (!pendingEntryId) throw new Error("Expected the pending terminal tab.");

      act(() => view.panels().bottom.onClose(pendingEntryId));
      await waitFor(() => expect(view.panels().bottom.tabs).toEqual([]));
      expect(view.panels().bottom.isVisible).toBe(false);

      create.resolve({
        ref: { terminalId: "terminal-abandoned" },
        summary: { ...summaryForTask("task-a"), terminalId: "terminal-abandoned" },
      });

      await waitFor(() =>
        expect(closeCalls).toEqual([{ terminalId: "terminal-abandoned", confirmTerminate: true }]),
      );
      await waitFor(() => expect(view.terminals().mountedTabs).toEqual([]));
      expect(terminals).toEqual([]);
    } finally {
      view.unmount();
    }
  });

  test("uses the typed terminal failure code for unsupported runtimes", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
        terminalCreate: async () => {
          throw new HostTerminalClientError(
            {
              code: "unsupported_runtime",
              message: "The runtime cannot launch an interactive terminal.",
            },
            null,
          );
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.terminals().startBlockedReason).toBeNull());
      act(() => {
        view.terminals().createTerminal();
      });
      await waitFor(() =>
        expect(view.terminals().tabs[0]?.requestState).toBe("unsupported_runtime"),
      );
      expect(view.terminals().tabs[0]?.error).toBe(
        "The runtime cannot launch an interactive terminal.",
      );
    } finally {
      view.unmount();
    }
  });

  test("keeps live terminal titles and tab order across host list refreshes", async () => {
    const first = summaryForTask("task-a");
    const second: TerminalSummary = {
      ...first,
      terminalId: "terminal-task-a-2",
      label: "/repo/worktrees/task-a",
      createdAt: "2026-07-13T00:01:00.000Z",
    };
    const baseDependencies = createTerminalTestDependencies();
    let listCalls = 0;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => {
          listCalls += 1;
          return { hostInstanceId: "host-1", terminals: [first, second] };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() =>
        expect(bottomTerminalIds(view.panels())).toEqual(["terminal-task-a", "terminal-task-a-2"]),
      );
      act(() => {
        view.terminals().onTitleChange(view.scopeKey(), first.terminalId, "pnpm run dev");
        const panels = view.panels();
        panels.onDrop(bottomEntryId(panels, "terminal-task-a-2"), "bottom", {
          id: bottomEntryId(panels, "terminal-task-a"),
          position: "before",
        });
      });
      expect(bottomTerminalIds(view.panels())).toEqual(["terminal-task-a-2", "terminal-task-a"]);

      const calls = listCalls;
      act(() => view.terminals().onRetryDiscovery());
      await waitFor(() => expect(listCalls).toBe(calls + 1));
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));

      expect(bottomTerminalIds(view.panels())).toEqual(["terminal-task-a-2", "terminal-task-a"]);
      expect(terminalTabLabel(requireTab(view.terminals().tabs[0]))).toBe("pnpm run dev");
    } finally {
      view.unmount();
    }
  });

  test("keeps terminal actions stable across presentation-only updates", async () => {
    const view = renderTaskTerminalPanels(createTerminalTestDependencies());
    const actionsOf = () => {
      const terminals = view.terminals();
      return {
        createTerminal: terminals.createTerminal,
        onRetryDiscovery: terminals.onRetryDiscovery,
        onRetryCreate: terminals.onRetryCreate,
        onTitleChange: terminals.onTitleChange,
        onClose: terminals.onClose,
        onLifecycle: terminals.onLifecycle,
        onForgotten: terminals.onForgotten,
      };
    };
    try {
      await waitFor(() => expect(view.terminals().tabs).toHaveLength(1));
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));
      const actions = actionsOf();

      act(() => view.terminals().onTitleChange(view.scopeKey(), "terminal-task-a", "pnpm run dev"));
      await waitFor(() =>
        expect(terminalTabLabel(requireTab(view.terminals().tabs[0]))).toBe("pnpm run dev"),
      );

      expect(actionsOf()).toEqual(actions);
    } finally {
      view.unmount();
    }
  });

  test("hides the bottom panel at once when its last terminal starts to close", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const terminals = [summaryForTask("task-a")];
    const close = Promise.withResolvers<{ closed: true }>();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
        terminalClose: async () => {
          const result = await close.promise;
          terminals.splice(0, terminals.length);
          return result;
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(1));
      await waitFor(() => expect(view.terminals().controller).not.toBeNull());
      expect(view.panels().bottom.isVisible).toBe(true);

      act(() => view.panels().bottom.onClose(bottomEntryId(view.panels(), "terminal-task-a")));

      await waitFor(() => expect(view.panels().bottom.tabs).toEqual([]));
      expect(view.panels().bottom.isVisible).toBe(false);
      expect(view.terminals().mountedTabs[0]?.tab.terminalId).toBe("terminal-task-a");

      await act(async () => {
        close.resolve({ closed: true });
        await close.promise;
      });
      await waitFor(() => expect(view.terminals().mountedTabs).toEqual([]));
      expect(view.panels().bottom.isVisible).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test("asks at once for a terminal that runs a command and changes nothing behind the dialog", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const closeCalls: boolean[] = [];
    let receiveFrame: ((frame: Uint8Array) => void) | null = null;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalClose: async ({ confirmTerminate }) => {
          closeCalls.push(confirmTerminate);
          return { closed: true };
        },
      },
      terminalBridge: {
        connect: async (onFrame, onStateChange) => {
          receiveFrame = onFrame;
          onStateChange("connected");
          return { send: async () => undefined, close: () => undefined };
        },
      },
    };
    const receive = (message: TerminalActivityMessage): void =>
      receiveFrame?.(encodeTerminalProtocolFrame({ message, payload: new Uint8Array() }));
    // Each render of the bottom panel while the close asks for a confirmation.
    const shown: string[] = [];
    let isRecording = false;
    const view = renderTaskTerminalPanels(dependencies, {
      children: ({ panels }) => {
        if (isRecording) {
          const { bottom } = panels;
          shown.push(`${bottom.presence}:${bottom.selectedTabId}:${bottom.tabs.length}`);
        }
        return null;
      },
    });
    try {
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(1));
      await waitFor(() => expect(receiveFrame).not.toBeNull());
      act(() => {
        receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
        receive({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "activity_updated",
          activity: { summary: summaryForTask("task-a"), command: "sleep 300" },
        });
        receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
      });
      await waitFor(() =>
        expect(view.terminals().runningCommandTerminalIds.has("terminal-task-a")).toBe(true),
      );
      const entryId = bottomEntryId(view.panels(), "terminal-task-a");

      isRecording = true;
      act(() => view.panels().bottom.onClose(entryId));
      isRecording = false;

      expect(view.panels().terminalClose.candidate?.terminalId).toBe("terminal-task-a");
      expect(closeCalls).toEqual([]);
      expect(new Set(shown)).toEqual(new Set([`open:${entryId}:1`]));

      act(() => view.panels().terminalClose.onConfirm());

      await waitFor(() => expect(view.panels().terminalClose.candidate).toBeNull());
      expect(closeCalls).toEqual([true]);
      await waitFor(() => expect(view.panels().bottom.isVisible).toBe(false));
    } finally {
      view.unmount();
    }
  });

  test("asks before it ends a running process and gives the tab back meanwhile", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const closeCalls: boolean[] = [];
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalClose: async ({ confirmTerminate }) => {
          closeCalls.push(confirmTerminate);
          return confirmTerminate
            ? { closed: true }
            : { closed: false, confirmationRequired: true };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(1));
      await waitFor(() => expect(view.terminals().controller).not.toBeNull());
      const entryId = bottomEntryId(view.panels(), "terminal-task-a");

      act(() => view.panels().bottom.onClose(entryId));

      await waitFor(() =>
        expect(view.panels().terminalClose.candidate?.terminalId).toBe("terminal-task-a"),
      );
      expect(view.panels().bottom.tabs.map((tab) => tab.id)).toEqual([entryId]);
      expect(view.panels().bottom.selectedTabId).toBe(entryId);
      expect(view.panels().bottom.isVisible).toBe(true);
      expect(closeCalls).toEqual([false]);

      act(() => view.panels().terminalClose.onConfirm());

      await waitFor(() => expect(view.panels().terminalClose.candidate).toBeNull());
      expect(closeCalls).toEqual([false, true]);
      expect(view.panels().bottom.isVisible).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test("hides the bottom panel when a refreshed host list no longer has its terminal", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let terminals = [summaryForTask("task-a")];
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(1));
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));
      act(() => view.panels().bottomToggle.onToggle());
      act(() => view.panels().bottomToggle.onToggle());
      expect(view.panels().bottom.isVisible).toBe(true);

      terminals = [];
      act(() => view.terminals().onRetryDiscovery());

      await waitFor(() => expect(view.panels().bottom.tabs).toEqual([]));
      expect(view.terminals().isSynced).toBe(true);
      expect(view.panels().bottom.isVisible).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test("hides the bottom panel after dismissing its final lost terminal", async () => {
    const view = renderTaskTerminalPanels(createTerminalTestDependencies());
    try {
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(1));
      act(() => {
        view
          .terminals()
          .onForgotten(view.scopeKey(), "terminal-task-a", "Terminal host restarted.");
      });
      await waitFor(() => expect(view.terminals().tabs[0]?.requestState).toBe("lost"));
      const entryId = view.panels().bottom.tabs[0]?.id;
      if (!entryId) throw new Error("Expected the lost terminal tab.");

      await act(async () => {
        view.panels().bottom.onClose(entryId);
      });

      await waitFor(() => expect(view.terminals().tabs).toEqual([]));
      expect(view.panels().bottom.isVisible).toBe(false);
    } finally {
      view.unmount();
    }
  });
});
