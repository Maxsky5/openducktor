import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TerminalSummary } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { terminalTabLifecycle } from "./terminal-presentation-state";
import { type AgentStudioTerminalTab, useAgentStudioTerminals } from "./use-agent-studio-terminals";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const summaryForTask = (taskId: string): TerminalSummary => ({
  terminalId: `terminal-${taskId}`,
  label: "Shell 1",
  context: { repoPath: "/repo", taskId },
  initialWorkingDir: `/repo/worktrees/${taskId}`,
  createdAt: "2026-07-13T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
});

const requireTab = (tab: AgentStudioTerminalTab | undefined): AgentStudioTerminalTab => {
  if (!tab) throw new Error("Expected a terminal tab.");
  return tab;
};

type TerminalTestDependencies = NonNullable<Parameters<typeof useAgentStudioTerminals>[1]>;

const createTerminalTestDependencies = (): TerminalTestDependencies => {
  const unavailable = createUnavailableShellBridge();
  return {
    hostClient: {
      ...unavailable.client,
      systemGetPlatform: async () => "darwin",
      terminalList: async ({ filter }) => {
        const taskId = filter.kind === "task" ? filter.taskId : "unassociated";
        return { hostInstanceId: "host-1", terminals: [summaryForTask(taskId)] };
      },
      taskWorktreeGet: async (_repoPath, taskId) => ({
        workingDirectory: `/repo/worktrees/${taskId}`,
      }),
    },
    terminalBridge: {
      connect: async (_onFrame, onStateChange) => {
        onStateChange("connected");
        return { send: async () => undefined, close: () => undefined };
      },
    },
  };
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("useAgentStudioTerminals", () => {
  test("keeps one stable tab while the authoritative list refreshes after creation", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const created = {
      ...summaryForTask("task-a"),
      terminalId: "terminal-created",
    };
    let terminalListCalls = 0;
    let releaseRefresh = (): void => undefined;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => {
          terminalListCalls += 1;
          if (terminalListCalls > 1) await refreshBlocked;
          return {
            hostInstanceId: "host-1",
            terminals: terminalListCalls > 1 ? [created] : [],
          };
        },
        terminalCreate: async () => ({
          ref: { terminalId: created.terminalId },
          summary: created,
        }),
      },
    };
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      act(() => getLatest().onCreate());
      await waitFor(() => expect(terminalListCalls).toBe(2));

      expect(getLatest().tabs).toHaveLength(1);
      expect(getLatest().tabs[0]).toMatchObject({
        terminalId: "terminal-created",
        summary: { label: "/repo/worktrees/task-a" },
        requestState: "ready",
      });
      expect(typeof getLatest().tabs[0]?.tabId).toBe("string");
      expect(getLatest().activeTabId).toBe(getLatest().tabs[0]?.tabId ?? null);
    } finally {
      releaseRefresh();
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
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().activeTabId).toBe("tab:terminal-task-a"));
      const previousFocusRequest = getLatest().focusRequest;

      act(() => getLatest().onCreate());

      await waitFor(
        () => {
          const activeTab = getLatest().tabs.find((tab) => tab.tabId === getLatest().activeTabId);
          expect(activeTab?.terminalId).toBe("terminal-created-second");
          expect(getLatest().focusRequest).toBe(previousFocusRequest + 1);
        },
        { timeout: 2_000 },
      );
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
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    let refetchTerminalList = async (): Promise<void> => {
      throw new Error("Query client is not ready.");
    };
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      const queryClient = useQueryClient();
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      refetchTerminalList = async () => {
        await queryClient.invalidateQueries();
      };
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-a"), {
        timeout: 2_000,
      });
      expect(terminalTabLifecycle(requireTab(getLatest().tabs[0]))).toBe("running");

      act(() => getLatest().onLifecycle("terminal-task-a", "exited"));
      await act(refetchTerminalList);

      expect(terminalListCalls).toBeGreaterThanOrEqual(2);
      expect(terminalTabLifecycle(requireTab(getLatest().tabs[0]))).toBe("exited");
    } finally {
      view.unmount();
    }
  });

  test("turns a forgotten terminal into an explicit non-recoverable tab", async () => {
    const dependencies = createTerminalTestDependencies();
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-a"), {
        timeout: 2_000,
      });

      act(() =>
        getLatest().onForgotten("terminal-task-a", "Terminal terminal-task-a was forgotten."),
      );

      expect(getLatest().tabs).toHaveLength(1);
      expect(getLatest().tabs[0]).toMatchObject({
        tabId: "tab:terminal-task-a",
        terminalId: null,
        requestState: "lost",
      });
      expect(getLatest().tabs[0]?.error).toContain(
        "cannot be recovered or recreated automatically",
      );
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
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    let refetchTerminalList = async (): Promise<void> => {
      throw new Error("Query client is not ready.");
    };
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      const queryClient = useQueryClient();
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      refetchTerminalList = async () => {
        await queryClient.invalidateQueries();
      };
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-a"), {
        timeout: 2_000,
      });

      hostInstanceId = "host-2";
      terminals = [];
      await act(refetchTerminalList);

      await waitFor(
        () =>
          expect(getLatest().tabs).toMatchObject([
            {
              tabId: "tab:terminal-task-a",
              terminalId: null,
              requestState: "lost",
            },
          ]),
        { timeout: 2_000 },
      );
      expect(getLatest().tabs[0]?.error).toContain("host restarted");
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
    localStorage.setItem(
      "openducktor:agent-studio-terminals:/repo:task-a",
      JSON.stringify({
        hostInstanceId: "host-1",
        visible: true,
        activeTerminalId: secondTerminal.terminalId,
        terminals: [firstTerminal, secondTerminal].map((terminal) => ({
          terminalId: terminal.terminalId,
          label: terminal.label,
          initialWorkingDir: terminal.initialWorkingDir,
        })),
      }),
    );
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
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(
        () => {
          expect(getLatest().isLoading).toBe(false);
          expect(getLatest().activeTabId).toBe("tab:terminal-task-a");
        },
        { timeout: 2_000 },
      );
      expect(localStorage.getItem("openducktor:agent-studio-terminals:/repo:task-a")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("hides the previous task synchronously and does not reuse its focus request", async () => {
    const dependencies = createTerminalTestDependencies();
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = ({ taskId }: { taskId: string }) => {
      const model = useAgentStudioTerminals({ repoPath: "/repo", taskId }, dependencies);
      latest = model;
      const terminalFocusOwner = useRef<HTMLButtonElement | null>(null);
      useEffect(() => {
        if (model.activeTabId !== null && model.focusRequest > 0) {
          terminalFocusOwner.current?.focus();
        }
      }, [model.activeTabId, model.focusRequest]);
      return (
        <>
          <button type="button">Chat input</button>
          <button ref={terminalFocusOwner} type="button">
            Terminal focus owner
          </button>
        </>
      );
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness taskId="task-a" />
      </QueryProvider>,
    );

    try {
      await waitFor(
        () => {
          expect(getLatest().isVisible).toBe(true);
          expect(getLatest().activeTabId).toBe("tab:terminal-task-a");
        },
        { timeout: 2_000 },
      );
      act(() => getLatest().onToggle());
      expect(getLatest().isVisible).toBe(false);
      expect(getLatest().focusRequest).toBe(0);
      const chatInput = view.getByRole("button", { name: "Chat input" });
      chatInput.focus();
      expect(document.activeElement).toBe(chatInput);

      await act(async () =>
        view.rerender(
          <QueryProvider useIsolatedClient>
            <Harness taskId="task-b" />
          </QueryProvider>,
        ),
      );
      expect(getLatest().scopeKey).toBe("/repo:task-b");
      expect(getLatest().tabs).toEqual([]);
      expect(getLatest().isVisible).toBe(false);

      await waitFor(
        () => {
          expect(getLatest().isVisible).toBe(true);
          expect(getLatest().activeTabId).toBe("tab:terminal-task-b");
        },
        { timeout: 2_000 },
      );
      expect(getLatest().focusRequest).toBe(0);
      expect(document.activeElement).toBe(chatInput);

      await act(async () =>
        view.rerender(
          <QueryProvider useIsolatedClient>
            <Harness taskId="task-a" />
          </QueryProvider>,
        ),
      );
      await waitFor(
        () => {
          expect(getLatest().isVisible).toBe(true);
          expect(getLatest().activeTabId).toBe("tab:terminal-task-a");
        },
        { timeout: 2_000 },
      );
      expect(getLatest().focusRequest).toBe(0);
      expect(document.activeElement).toBe(chatInput);
    } finally {
      view.unmount();
    }
  }, 5_000);

  test("keeps one terminal transport while switching task scopes", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let connectCalls = 0;
    let closeCalls = 0;
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      terminalBridge: {
        connect: async (_onFrame, _onStateChange) => {
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
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = ({ taskId }: { taskId: string }) => {
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId }, dependencies);
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness taskId="task-a" />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(getLatest().controller).not.toBeNull();
      expect(connectCalls).toBe(1);
      expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-a");
    });

    act(() =>
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness taskId="task-b" />
        </QueryProvider>,
      ),
    );
    await waitFor(() => {
      expect(getLatest().scopeKey).toBe("/repo:task-b");
      expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-b");
    });

    expect(connectCalls).toBe(1);
    expect(closeCalls).toBe(0);

    view.unmount();
    expect(closeCalls).toBe(1);
  });

  test("restores task-local tab order and active selection when returning to a task", async () => {
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
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = ({ taskId }: { taskId: string }) => {
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId }, dependencies);
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness taskId="task-a" />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().tabs).toHaveLength(2));
      act(() => {
        getLatest().onReorderTab("tab:terminal-task-a-2", "tab:terminal-task-a", "before");
        getLatest().onSelectTab("tab:terminal-task-a-2");
      });
      expect(getLatest().tabs.map((tab) => tab.terminalId)).toEqual([
        "terminal-task-a-2",
        "terminal-task-a",
      ]);
      expect(getLatest().activeTabId).toBe("tab:terminal-task-a-2");
      expect(getLatest().focusRequest).toBe(1);
      expect(getLatest().mountedTabs.map((tab) => tab.terminalId)).toEqual([
        "terminal-task-a",
        "terminal-task-a-2",
      ]);

      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness taskId="task-b" />
        </QueryProvider>,
      );
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-b"));

      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness taskId="task-a" />
        </QueryProvider>,
      );
      await waitFor(() => expect(getLatest().tabs).toHaveLength(2));

      expect(getLatest().tabs.map((tab) => tab.terminalId)).toEqual([
        "terminal-task-a-2",
        "terminal-task-a",
      ]);
      expect(getLatest().activeTabId).toBe("tab:terminal-task-a-2");
    } finally {
      view.unmount();
    }
  }, 5_000);
});
