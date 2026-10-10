import { describe, expect, spyOn, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { SessionPanel } from "@/features/session-panels";
import { terminalTabLabel, terminalTabLifecycle } from "@/features/terminals";
import * as terminalMountModule from "@/features/terminals/terminal-viewport-mount";
import {
  bottomEntryId,
  bottomTerminalIds,
  createTerminalTestDependencies,
  renderTaskTerminalPanels,
  requireTab,
  selectedBottomTerminal,
  summaryForTask,
  type TaskTerminalPanels,
  type TerminalTestDependencies,
} from "./agent-studio-terminals-test-harness";

describe("useAgentStudioTerminals reconciliation", () => {
  test("keeps one stable tab while the authoritative list refreshes after creation", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const created = { ...summaryForTask("task-a"), terminalId: "terminal-created" };
    let terminalListCalls = 0;
    const refresh = Promise.withResolvers<void>();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => {
          terminalListCalls += 1;
          if (terminalListCalls > 1) await refresh.promise;
          return { hostInstanceId: "host-1", terminals: terminalListCalls > 1 ? [created] : [] };
        },
        terminalCreate: async () => ({ ref: { terminalId: created.terminalId }, summary: created }),
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.terminals().startBlockedReason).toBeNull());
      act(() => view.panels().bottomToggle.onToggle());
      await waitFor(() => expect(terminalListCalls).toBe(2));

      expect(view.terminals().tabs).toHaveLength(1);
      expect(view.terminals().tabs[0]).toMatchObject({
        terminalId: "terminal-created",
        summary: { label: "/repo/worktrees/task-a" },
        requestState: "ready",
      });
      expect(bottomTerminalIds(view.panels())).toEqual(["terminal-created"]);
      expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-created");
    } finally {
      refresh.resolve();
      view.unmount();
    }
  });

  test("selects the newly created terminal instead of returning to the previous tab", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const terminals: TerminalSummary[] = [summaryForTask("task-a")];
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
        terminalCreate: async ({ context }) => {
          const terminal: TerminalSummary = {
            ...summaryForTask("taskId" in context ? context.taskId : "unassociated"),
            terminalId: "terminal-created-second",
            label: "Shell 2",
          };
          terminals.push(terminal);
          return { ref: { terminalId: terminal.terminalId }, summary: terminal };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() =>
        expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a"),
      );
      await waitFor(() => expect(view.terminals().startBlockedReason).toBeNull());
      const previousFocusRequest = view.panels().bottom.focusRequest;

      act(() => view.panels().bottom.onAddTab());
      act(() => view.panels().bottom.onPick("terminal"));

      await waitFor(
        () => {
          expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-created-second");
          expect(view.panels().bottom.focusRequest).toBe(previousFocusRequest + 1);
        },
        { timeout: 2_000 },
      );
      expect(bottomTerminalIds(view.panels())).toEqual([
        "terminal-task-a",
        "terminal-created-second",
      ]);
    } finally {
      view.unmount();
    }
  });

  test("keeps a lifecycle frame authoritative over a stale terminal-list snapshot", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let terminalListCalls = 0;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async (input) => {
          terminalListCalls += 1;
          return baseDependencies.hostClient.terminalList(input);
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.terminals().tabs[0]?.terminalId).toBe("terminal-task-a"), {
        timeout: 2_000,
      });
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));
      expect(terminalTabLifecycle(requireTab(view.terminals().tabs[0]))).toBe("running");

      act(() => view.terminals().onLifecycle(view.scopeKey(), "terminal-task-a", "exited"));
      act(() => view.terminals().onRetryDiscovery());
      await waitFor(() => expect(terminalListCalls).toBeGreaterThanOrEqual(2));
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));

      expect(terminalTabLifecycle(requireTab(view.terminals().tabs[0]))).toBe("exited");
    } finally {
      view.unmount();
    }
  });

  test("turns a forgotten terminal into an explicit non-recoverable tab", async () => {
    const view = renderTaskTerminalPanels(createTerminalTestDependencies());
    try {
      await waitFor(() => expect(view.terminals().tabs[0]?.terminalId).toBe("terminal-task-a"), {
        timeout: 2_000,
      });

      act(() =>
        view
          .terminals()
          .onForgotten(
            view.scopeKey(),
            "terminal-task-a",
            "Terminal terminal-task-a was forgotten.",
          ),
      );

      expect(view.terminals().tabs).toHaveLength(1);
      expect(view.terminals().tabs[0]).toMatchObject({
        tabId: "tab:terminal-task-a",
        terminalId: null,
        requestState: "lost",
      });
      expect(view.terminals().tabs[0]?.error).toContain(
        "cannot be recovered or recreated automatically",
      );
      expect(view.panels().bottom.tabs).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  test("keeps previous-host terminals visible as lost after the host instance changes", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let hostInstanceId = "host-1";
    let terminals = [summaryForTask("task-a")];
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId, terminals }),
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.terminals().tabs[0]?.terminalId).toBe("terminal-task-a"), {
        timeout: 2_000,
      });
      await waitFor(() => expect(view.terminals().isLoading).toBe(false));

      hostInstanceId = "host-2";
      terminals = [];
      act(() => view.terminals().onRetryDiscovery());

      await waitFor(
        () =>
          expect(view.terminals().tabs).toMatchObject([
            { tabId: "tab:terminal-task-a", terminalId: null, requestState: "lost" },
          ]),
        { timeout: 2_000 },
      );
      expect(view.terminals().tabs[0]?.error).toContain("host restarted");
      expect(view.panels().bottom.tabs).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  test("selects the first host terminal without reading persisted active state", async () => {
    const firstTerminal = summaryForTask("task-a");
    const secondTerminal: TerminalSummary = {
      ...firstTerminal,
      terminalId: "terminal-task-a-2",
      label: "Shell 2",
      createdAt: "2026-07-13T00:01:00.000Z",
    };
    const baseDependencies = createTerminalTestDependencies();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({
          hostInstanceId: "host-1",
          terminals: [firstTerminal, secondTerminal],
        }),
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(
        () => {
          expect(view.terminals().isLoading).toBe(false);
          expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a");
        },
        { timeout: 2_000 },
      );
    } finally {
      view.unmount();
    }
  });

  test("hides the previous task synchronously and does not reuse its focus request", async () => {
    function FocusProbe({ result }: { result: TaskTerminalPanels }) {
      const terminalFocusOwner = useRef<HTMLButtonElement | null>(null);
      const { selectedTabId, focusRequest } = result.panels.bottom;
      useEffect(() => {
        if (selectedTabId !== null && focusRequest > 0) terminalFocusOwner.current?.focus();
      }, [focusRequest, selectedTabId]);
      return (
        <>
          <button type="button">Chat input</button>
          <button ref={terminalFocusOwner} type="button">
            Terminal focus owner
          </button>
        </>
      );
    }
    const view = renderTaskTerminalPanels(createTerminalTestDependencies(), {
      children: (result) => <FocusProbe result={result} />,
    });
    try {
      await waitFor(
        () => {
          expect(view.panels().bottom.isVisible).toBe(true);
          expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a");
        },
        { timeout: 2_000 },
      );
      act(() => view.panels().bottomToggle.onToggle());
      expect(view.panels().bottom.isVisible).toBe(false);
      expect(view.panels().bottom.focusRequest).toBe(0);
      const chatInput = screen.getByRole("button", { name: "Chat input" });
      chatInput.focus();
      expect(document.activeElement).toBe(chatInput);

      await act(async () => view.update({ taskId: "task-b", mountedTaskIds: ["task-b"] }));
      expect(view.terminals().scopeKey).toBe(view.scopeKey("task-b"));
      expect(view.panels().bottom.tabs).toEqual([]);
      expect(view.panels().bottom.isVisible).toBe(false);

      await waitFor(
        () => {
          expect(view.panels().bottom.isVisible).toBe(true);
          expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-b");
        },
        { timeout: 2_000 },
      );
      expect(view.panels().bottom.focusRequest).toBe(0);
      expect(document.activeElement).toBe(chatInput);

      await act(async () => view.update({ taskId: "task-a", mountedTaskIds: ["task-a"] }));
      await waitFor(
        () => {
          expect(view.panels().bottom.isVisible).toBe(true);
          expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a");
        },
        { timeout: 2_000 },
      );
      expect(view.panels().bottom.focusRequest).toBe(0);
      expect(document.activeElement).toBe(chatInput);
    } finally {
      view.unmount();
    }
  }, 5_000);

  test("keeps task terminals live, scoped, and bounded across cached task switches", async () => {
    const probes = new Map<
      string,
      Array<{
        disposals: number;
        mounts: number;
        input: Parameters<typeof terminalMountModule.mountTerminalViewport>[0];
      }>
    >();
    const mountSpy = spyOn(terminalMountModule, "mountTerminalViewport").mockImplementation(
      (input) => {
        const probe = { disposals: 0, input, mounts: 1 };
        const terminalProbes = probes.get(input.terminalId) ?? [];
        terminalProbes.push(probe);
        probes.set(input.terminalId, terminalProbes);
        input.onHydrated();
        return {
          activate: () => undefined,
          dispose: () => {
            probe.disposals += 1;
          },
        };
      },
    );
    const view = renderTaskTerminalPanels(createTerminalTestDependencies(), {
      mountedTaskIds: ["task-a", "task-b"],
      children: (result) => <SessionPanel model={result.panels.bottom} />,
    });
    const showTask = (taskId: string, mountedTaskIds = ["task-a", "task-b"]) =>
      view.update({ taskId, mountedTaskIds });

    try {
      await waitFor(() => {
        expect(view.terminals().mountedTabs.map(({ tab }) => tab.terminalId)).toEqual([
          "terminal-task-a",
        ]);
        expect(probes.get("terminal-task-a")?.[0]?.mounts).toBe(1);
      });

      showTask("task-b");
      await waitFor(() => {
        expect(view.terminals().mountedTabs.map(({ tab }) => tab.terminalId)).toEqual([
          "terminal-task-a",
          "terminal-task-b",
        ]);
        expect(probes.get("terminal-task-b")?.[0]?.mounts).toBe(1);
      });
      const taskAProbe = probes.get("terminal-task-a")?.[0];
      const taskBProbe = probes.get("terminal-task-b")?.[0];
      if (!taskAProbe || !taskBProbe) throw new Error("Expected both terminal probes.");
      expect(probes.get("terminal-task-a")).toHaveLength(1);
      expect(probes.get("terminal-task-b")).toHaveLength(1);
      for (let index = 0; index < 40; index += 1) {
        showTask(index % 2 === 0 ? "task-a" : "task-b");
      }
      expect(probes.get("terminal-task-a")).toEqual([taskAProbe]);
      expect(probes.get("terminal-task-b")).toEqual([taskBProbe]);
      act(() => {
        taskAProbe.input.onTitleChange("Task A title");
        taskAProbe.input.onLifecycle("exited", { text: "Task A exited.", isFailure: true });
      });

      showTask("task-a");
      await waitFor(() => {
        expect(view.terminals().tabs[0]?.summary?.label).toBe("Task A title");
        expect(view.terminals().tabs[0]?.summary?.lifecycle).toBe("exited");
      });

      showTask("task-b");
      act(() => taskAProbe.input.onForgotten("Task A terminal was forgotten.", null));
      await waitFor(() => expect(taskAProbe.disposals).toBe(1));

      showTask("task-a");
      expect(view.terminals().tabs[0]).toMatchObject({
        error: "Task A terminal was forgotten. It cannot be recovered or recreated automatically.",
        label: "Task A title",
        requestState: "lost",
      });

      showTask("task-a", ["task-a"]);
      expect(view.terminals().mountedTabs.map(({ tab }) => terminalTabLabel(tab))).toEqual([
        "Task A title",
      ]);
      expect(taskBProbe.disposals).toBe(1);
    } finally {
      view.unmount();
      mountSpy.mockRestore();
    }
  }, 5_000);

  test("keeps one terminal transport while switching task scopes", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let connectCalls = 0;
    let closeCalls = 0;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      terminalBridge: {
        connect: async () => {
          connectCalls += 1;
          return {
            send: async () => undefined,
            close: () => {
              closeCalls += 1;
            },
          };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => {
        expect(view.terminals().controller).not.toBeNull();
        expect(connectCalls).toBe(1);
        expect(view.terminals().tabs[0]?.terminalId).toBe("terminal-task-a");
      });

      act(() => view.update({ taskId: "task-b", mountedTaskIds: ["task-b"] }));
      await waitFor(() => {
        expect(view.terminals().scopeKey).toBe(view.scopeKey("task-b"));
        expect(view.terminals().tabs[0]?.terminalId).toBe("terminal-task-b");
      });

      expect(connectCalls).toBe(1);
      expect(closeCalls).toBe(0);
    } finally {
      view.unmount();
      expect(closeCalls).toBe(1);
    }
  });

  test("restores task-local tab order and selection when returning to a task", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const summaries = (taskId: string): TerminalSummary[] => [
      summaryForTask(taskId),
      {
        ...summaryForTask(taskId),
        terminalId: `terminal-${taskId}-2`,
        createdAt: "2026-07-13T00:01:00.000Z",
      },
    ];
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async ({ filter }) => {
          const taskId = filter.kind === "task" ? filter.taskId : "unassociated";
          return { hostInstanceId: "host-1", terminals: summaries(taskId) };
        },
      },
    };
    const view = renderTaskTerminalPanels(dependencies);
    try {
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(2));
      act(() => {
        const panels = view.panels();
        panels.onDrop(bottomEntryId(panels, "terminal-task-a-2"), "bottom", {
          id: bottomEntryId(panels, "terminal-task-a"),
          position: "before",
        });
      });
      act(() => view.panels().bottom.onSelect(bottomEntryId(view.panels(), "terminal-task-a-2")));
      expect(bottomTerminalIds(view.panels())).toEqual(["terminal-task-a-2", "terminal-task-a"]);
      expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a-2");
      expect(view.panels().bottom.focusRequest).toBe(1);

      view.update({ taskId: "task-b", mountedTaskIds: ["task-b"] });
      await waitFor(() => expect(view.terminals().tabs[0]?.terminalId).toBe("terminal-task-b"));

      view.update({ taskId: "task-a", mountedTaskIds: ["task-a"] });
      await waitFor(() => expect(view.panels().bottom.tabs).toHaveLength(2));

      expect(bottomTerminalIds(view.panels())).toEqual(["terminal-task-a-2", "terminal-task-a"]);
      expect(selectedBottomTerminal(view.panels())?.terminalId).toBe("terminal-task-a-2");
    } finally {
      view.unmount();
    }
  }, 5_000);
});
