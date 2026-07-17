import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TerminalSummary } from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { useAgentStudioTerminals } from "./use-agent-studio-terminals";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const summaryForTask = (taskId: string): TerminalSummary => ({
  terminalId: `terminal-${taskId}`,
  hostInstanceId: "host-1",
  label: "Shell 1",
  context: { taskId },
  initialWorkingDir: `/repo/worktrees/${taskId}`,
  initialWorkingDirAvailable: true,
  createdAt: "2026-07-13T00:00:00.000Z",
  lifecycle: "running",
  connectionState: "connected",
  attentionState: "none",
  exit: null,
});

type TerminalTestDependencies = NonNullable<Parameters<typeof useAgentStudioTerminals>[1]>;

const createTerminalTestDependencies = (): TerminalTestDependencies => {
  const unavailable = createUnavailableShellBridge();
  return {
    hostClient: {
      ...unavailable.client,
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
  test("reopens the panel when the host lists existing task terminals", async () => {
    localStorage.setItem(
      "openducktor:agent-studio-terminals:/repo:task-a",
      JSON.stringify({
        hostInstanceId: "host-1",
        visible: true,
        activeTerminalId: "terminal-6",
        terminals: Array.from({ length: 6 }, (_, index) => ({
          terminalId: `terminal-${index + 1}`,
          label: `Shell ${index + 1}`,
          initialWorkingDir: "/repo/worktrees/task-a",
        })),
      }),
    );
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
      await waitFor(() => expect(getLatest().isLoading).toBe(false));

      expect(getLatest().tabs.map((tab) => tab.terminalId)).toEqual(["terminal-task-a"]);
      expect(getLatest().activeTabId).toBe("tab:terminal-task-a");
      expect(getLatest().isVisible).toBe(true);
      expect(localStorage.getItem("openducktor:agent-studio-terminals:/repo:task-a")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("opening an empty terminal panel creates and selects a terminal", async () => {
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
            ...summaryForTask(context.taskId ?? "unassociated"),
            terminalId: "terminal-created",
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
      await waitFor(() => {
        expect(getLatest().isLoading).toBe(false);
        expect(getLatest().tabs).toEqual([]);
      });

      act(() => getLatest().onToggle());

      await waitFor(
        () => {
          expect(createCalls).toBe(1);
          expect(getLatest().isVisible).toBe(true);
          expect(getLatest().tabs[0]?.terminalId).toBe("terminal-created");
          expect(getLatest().activeTabId).toBe(getLatest().tabs[0]?.tabId ?? null);
        },
        { timeout: 2_000 },
      );
    } finally {
      view.unmount();
    }
  });

  test("uses the worktree path while a new terminal is being created", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let resolveCreate = (_value: { ref: { terminalId: string }; summary: TerminalSummary }): void =>
      undefined;
    const createPending = new Promise<{
      ref: { terminalId: string };
      summary: TerminalSummary;
    }>((resolve) => {
      resolveCreate = resolve;
    });
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
        terminalCreate: async () => createPending,
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
      await waitFor(() => expect(getLatest().tabs[0]?.requestState).toBe("creating"));
      expect(getLatest().tabs[0]?.label).toBe("/repo/worktrees/task-a");
    } finally {
      resolveCreate({
        ref: { terminalId: "terminal-created" },
        summary: {
          ...summaryForTask("task-a"),
          terminalId: "terminal-created",
        },
      });
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
    let latest: ReturnType<typeof useAgentStudioTerminals> | null = null;
    const getLatest = (): ReturnType<typeof useAgentStudioTerminals> => {
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
      await waitFor(() => expect(getLatest().tabs[0]?.requestState).toBe("unsupported_runtime"));
      expect(getLatest().tabs[0]?.error).toBe("The runtime cannot launch an interactive terminal.");
    } finally {
      view.unmount();
    }
  });

  test("keeps live terminal titles and drag order across host list refreshes", async () => {
    const first = summaryForTask("task-a");
    const second: TerminalSummary = {
      ...first,
      terminalId: "terminal-task-a-2",
      label: "/repo/worktrees/task-a",
      createdAt: "2026-07-13T00:01:00.000Z",
    };
    const baseDependencies = createTerminalTestDependencies();
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [first, second] }),
      },
    };
    type HookResult = ReturnType<typeof useAgentStudioTerminals>;
    let latest: HookResult | null = null;
    let refresh = async (): Promise<void> => undefined;
    const getLatest = (): HookResult => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      const queryClient = useQueryClient();
      latest = useAgentStudioTerminals({ repoPath: "/repo", taskId: "task-a" }, dependencies);
      refresh = async () => {
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
      await waitFor(() => expect(getLatest().tabs).toHaveLength(2));
      act(() => {
        getLatest().onTitleChange(first.terminalId, "pnpm run dev");
        getLatest().onReorderTab("tab:terminal-task-a-2", "tab:terminal-task-a", "before");
      });
      expect(getLatest().tabs.map((tab) => tab.terminalId)).toEqual([
        "terminal-task-a-2",
        "terminal-task-a",
      ]);
      expect(getLatest().tabs[1]?.label).toBe("pnpm run dev");

      await act(refresh);

      expect(getLatest().tabs.map((tab) => tab.terminalId)).toEqual([
        "terminal-task-a-2",
        "terminal-task-a",
      ]);
      expect(getLatest().tabs[1]?.label).toBe("pnpm run dev");
    } finally {
      view.unmount();
    }
  });

  test("hides the final tab immediately while its terminal shuts down", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const terminals = [summaryForTask("task-a")];
    let resolveClose = (_result: { closed: true }): void => undefined;
    const closePending = new Promise<{ closed: true }>((resolve) => {
      resolveClose = resolve;
    });
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
        terminalClose: async () => {
          const result = await closePending;
          terminals.splice(0, terminals.length);
          return result;
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
      await waitFor(() => expect(getLatest().tabs).toHaveLength(1));
      expect(getLatest().isVisible).toBe(true);

      let closePromise: Promise<{ closed: boolean }> | null = null;
      act(() => {
        const tab = getLatest().tabs[0];
        if (!tab) throw new Error("Expected the live terminal tab.");
        closePromise = getLatest().onClose(tab, false);
      });

      try {
        await waitFor(() => expect(getLatest().tabs).toEqual([]));
        expect(getLatest().mountedTabs).toHaveLength(1);
        expect(getLatest().mountedTabs[0]?.terminalId).toBe("terminal-task-a");
        expect(getLatest().isVisible).toBe(false);
      } finally {
        resolveClose({ closed: true });
        await act(async () => {
          await closePromise;
        });
      }
      expect(getLatest().tabs).toEqual([]);
      expect(getLatest().mountedTabs).toEqual([]);
      expect(getLatest().isVisible).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test("keeps the same terminal mounted when confirmation is required", async () => {
    const baseDependencies = createTerminalTestDependencies();
    let resolveClose = (_result: { closed: false; confirmationRequired: true }): void => undefined;
    const closePending = new Promise<{ closed: false; confirmationRequired: true }>((resolve) => {
      resolveClose = resolve;
    });
    const dependencies: TerminalTestDependencies = {
      ...baseDependencies,
      hostClient: {
        ...baseDependencies.hostClient,
        terminalClose: async () => closePending,
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
      await waitFor(() => expect(getLatest().tabs).toHaveLength(1));
      const originalTab = getLatest().tabs[0];
      let closePromise: ReturnType<HookResult["onClose"]> | null = null;
      act(() => {
        const tab = getLatest().tabs[0];
        if (!tab) throw new Error("Expected the live terminal tab.");
        closePromise = getLatest().onClose(tab, false);
      });

      await waitFor(() => expect(getLatest().tabs).toEqual([]));
      expect(getLatest().mountedTabs[0]?.tabId).toBe(originalTab?.tabId);
      expect(getLatest().mountedTabs[0]?.terminalId).toBe(originalTab?.terminalId);
      expect(getLatest().isVisible).toBe(false);

      resolveClose({ closed: false, confirmationRequired: true });
      await act(async () => {
        expect(await closePromise).toEqual({ closed: false, confirmationRequired: true });
      });

      expect(getLatest().tabs).toHaveLength(1);
      expect(getLatest().mountedTabs).toHaveLength(1);
      expect(getLatest().tabs[0]?.terminalId).toBe("terminal-task-a");
      expect(getLatest().activeTabId).toBe("tab:terminal-task-a");
      expect(getLatest().isVisible).toBe(true);
    } finally {
      view.unmount();
    }
  });

  test("hides the panel after dismissing its final lost terminal", async () => {
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
      await waitFor(() => expect(getLatest().tabs).toHaveLength(1));
      act(() => {
        getLatest().onForgotten("terminal-task-a", "Terminal host restarted.");
      });
      await waitFor(() => expect(getLatest().tabs[0]?.requestState).toBe("lost"));

      await act(async () => {
        const tab = getLatest().tabs[0];
        if (!tab) throw new Error("Expected the lost terminal tab.");
        await getLatest().onClose(tab, false);
      });

      expect(getLatest().tabs).toEqual([]);
      expect(getLatest().isVisible).toBe(false);
    } finally {
      view.unmount();
    }
  });

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
        label: "/repo/worktrees/task-a",
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
            ...summaryForTask(context.taskId ?? "unassociated"),
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

      act(() => getLatest().onCreate());

      await waitFor(
        () => {
          const activeTab = getLatest().tabs.find((tab) => tab.tabId === getLatest().activeTabId);
          expect(activeTab?.terminalId).toBe("terminal-created-second");
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
      expect(getLatest().tabs[0]).toHaveProperty("lifecycle", "running");

      act(() => getLatest().onLifecycle("terminal-task-a", "exited"));
      await act(refetchTerminalList);

      expect(terminalListCalls).toBeGreaterThanOrEqual(2);
      expect(getLatest().tabs[0]).toHaveProperty("lifecycle", "exited");
      expect(getLatest().runningCount).toBe(0);
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
        tabId: "lost:terminal-task-a",
        terminalId: null,
        lifecycle: null,
        requestState: "lost",
      });
      expect(getLatest().tabs[0]?.error).toContain(
        "cannot be recovered or recreated automatically",
      );
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
