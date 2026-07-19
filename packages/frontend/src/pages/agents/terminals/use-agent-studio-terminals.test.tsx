import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TerminalSummary } from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { TerminalTab } from "@/features/terminals";
import { terminalTabLabel } from "@/features/terminals/terminal-presentation-state";
import { QueryProvider } from "@/lib/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { useAgentStudioTerminals } from "./use-agent-studio-terminals";

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

const requireTab = (tab: TerminalTab | undefined): TerminalTab => {
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
            ...summaryForTask("taskId" in context ? context.taskId : "unassociated"),
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
      expect(terminalTabLabel(requireTab(getLatest().tabs[0]))).toBe("/repo/worktrees/task-a");
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

  test("terminates a terminal whose pending creation tab was closed", async () => {
    const baseDependencies = createTerminalTestDependencies();
    const terminals: TerminalSummary[] = [];
    const closeCalls: Array<{ terminalId: string; confirmTerminate: boolean }> = [];
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
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [...terminals] }),
        terminalCreate: async () => {
          const created = await createPending;
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
      await waitFor(() => expect(getLatest().tabs[0]?.requestState).toBe("creating"));
      const pendingTab = getLatest().tabs[0];
      if (!pendingTab) throw new Error("Expected the pending terminal tab.");

      await act(async () => {
        expect(await getLatest().onClose(pendingTab, false)).toEqual({ closed: true });
      });
      expect(getLatest().tabs).toEqual([]);

      resolveCreate({
        ref: { terminalId: "terminal-abandoned" },
        summary: { ...summaryForTask("task-a"), terminalId: "terminal-abandoned" },
      });

      await waitFor(() =>
        expect(closeCalls).toEqual([{ terminalId: "terminal-abandoned", confirmTerminate: true }]),
      );
      await waitFor(() => expect(getLatest().mountedTabs).toEqual([]));
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
      expect(terminalTabLabel(requireTab(getLatest().tabs[1]))).toBe("pnpm run dev");

      await act(refresh);

      expect(getLatest().tabs.map((tab) => tab.terminalId)).toEqual([
        "terminal-task-a-2",
        "terminal-task-a",
      ]);
      expect(terminalTabLabel(requireTab(getLatest().tabs[1]))).toBe("pnpm run dev");
    } finally {
      view.unmount();
    }
  });

  test("keeps terminal actions stable across presentation-only updates", async () => {
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
      const actions = {
        onToggle: getLatest().onToggle,
        onHide: getLatest().onHide,
        onSelectTab: getLatest().onSelectTab,
        onCreate: getLatest().onCreate,
        onRetryCreate: getLatest().onRetryCreate,
        onReorderTab: getLatest().onReorderTab,
        onTitleChange: getLatest().onTitleChange,
        onClose: getLatest().onClose,
        onLifecycle: getLatest().onLifecycle,
        onForgotten: getLatest().onForgotten,
      };

      act(() => getLatest().onTitleChange("terminal-task-a", "pnpm run dev"));
      await waitFor(() =>
        expect(terminalTabLabel(requireTab(getLatest().tabs[0]))).toBe("pnpm run dev"),
      );

      expect({
        onToggle: getLatest().onToggle,
        onHide: getLatest().onHide,
        onSelectTab: getLatest().onSelectTab,
        onCreate: getLatest().onCreate,
        onRetryCreate: getLatest().onRetryCreate,
        onReorderTab: getLatest().onReorderTab,
        onTitleChange: getLatest().onTitleChange,
        onClose: getLatest().onClose,
        onLifecycle: getLatest().onLifecycle,
        onForgotten: getLatest().onForgotten,
      }).toEqual(actions);
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
});
