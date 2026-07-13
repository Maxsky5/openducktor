import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TerminalSummary } from "@openducktor/contracts";
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
