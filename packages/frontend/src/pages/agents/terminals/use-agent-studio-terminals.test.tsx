import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TerminalSummary } from "@openducktor/contracts";
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

const rememberVisibleTerminal = (taskId: string): void => {
  localStorage.setItem(
    `openducktor:agent-studio-terminals:/repo:${taskId}`,
    JSON.stringify({
      hostInstanceId: "host-1",
      visible: true,
      activeTerminalId: `terminal-${taskId}`,
      terminals: [
        {
          terminalId: `terminal-${taskId}`,
          label: "Shell 1",
          initialWorkingDir: `/repo/worktrees/${taskId}`,
        },
      ],
    }),
  );
};

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
  test("keeps a lifecycle frame authoritative over a stale terminal-list snapshot", async () => {
    rememberVisibleTerminal("task-a");
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
    rememberVisibleTerminal("task-a");
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

  test("restores a remembered non-first active terminal before persisting host state", async () => {
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
          expect(getLatest().activeTabId).toBe("tab:terminal-task-a-2");
        },
        { timeout: 2_000 },
      );
      const stored = JSON.parse(
        localStorage.getItem("openducktor:agent-studio-terminals:/repo:task-a") ?? "null",
      ) as { activeTerminalId?: string } | null;
      expect(stored?.activeTerminalId).toBe("terminal-task-a-2");
    } finally {
      view.unmount();
    }
  });

  test("hides the previous task synchronously and does not reuse its focus request", async () => {
    rememberVisibleTerminal("task-a");
    rememberVisibleTerminal("task-b");
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
      act(() => getLatest().onToggle());
      expect(getLatest().focusRequest).toBe(1);
      await waitFor(() => {
        expect(document.activeElement?.textContent).toBe("Terminal focus owner");
      });
      const chatInput = view.getByRole("button", { name: "Chat input" });
      chatInput.focus();
      expect(document.activeElement).toBe(chatInput);

      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness taskId="task-b" />
        </QueryProvider>,
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

      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness taskId="task-a" />
        </QueryProvider>,
      );
      await waitFor(
        () => {
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
});
