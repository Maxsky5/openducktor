import { describe, expect, mock, test } from "bun:test";
import type { RepoAction, TerminalListResponse, TerminalSummary } from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { useTerminals, type TerminalDependencies, type TerminalScope } from "./use-terminals";

/** The tab ID that a start returns inside an act callback. */
type StartedTerminal = { tabId: string | null };

describe("useTerminals", () => {
  test("reports synced tabs only after they include the latest host list", async () => {
    const discovery = Promise.withResolvers<TerminalListResponse>();
    const view = renderModel(mock(() => discovery.promise));
    try {
      expect(view.result.current.isSynced).toBe(false);
      await act(async () => {
        discovery.resolve({ hostInstanceId: "host-1", terminals: [existingTerminal()] });
        await discovery.promise;
      });
      await waitFor(() => expect(view.result.current.isSynced).toBe(true), { timeout: 500 });
      expect(view.result.current.tabs[0]?.terminalId).toBe("existing-terminal");
    } finally {
      view.unmount();
    }
  });

  test("starts a terminal and returns its tab ID before the host answers", async () => {
    const terminal = existingTerminal();
    const view = renderModel(mock(async () => ({ hostInstanceId: "host-1", terminals: [] })));
    const create = Promise.withResolvers<{
      ref: { terminalId: string };
      summary: TerminalSummary;
    }>();
    view.terminalCreate.mockImplementation(() => create.promise);
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      const started: StartedTerminal = { tabId: null };
      act(() => {
        started.tabId = view.result.current.createTerminal();
      });

      expect(started.tabId).not.toBeNull();
      expect(view.result.current.tabs.map((tab) => tab.tabId)).toEqual([started.tabId ?? ""]);
      expect(view.result.current.startBlockedReason).toBe("A terminal is starting.");
      let blockedTabId: string | null = "not called";
      act(() => {
        blockedTabId = view.result.current.createTerminal();
      });
      expect(blockedTabId).toBeNull();
      expect(view.terminalCreate).toHaveBeenCalledTimes(1);

      await act(async () => {
        create.resolve({ ref: { terminalId: terminal.terminalId }, summary: terminal });
        await create.promise;
      });
      await waitFor(
        () => expect(view.result.current.tabs[0]?.terminalId).toBe("existing-terminal"),
        { timeout: 500 },
      );
      expect(view.result.current.tabs[0]?.tabId).toBe(started.tabId ?? "");
    } finally {
      view.unmount();
    }
  });

  test("blocks creation after failed discovery and retries the host list", async () => {
    const terminal = existingTerminal();
    const result = { hostInstanceId: "host-1", terminals: [terminal] };
    const retry = Promise.withResolvers<typeof result>();
    const terminalList = mock(async () => result)
      .mockRejectedValueOnce(new Error("Terminal discovery unavailable."))
      .mockImplementationOnce(() => retry.promise);
    const view = renderModel(terminalList);
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      act(() => {
        expect(view.result.current.createTerminal()).toBeNull();
      });
      expect(view.terminalCreate).not.toHaveBeenCalled();
      expect(view.result.current.discoveryError).toBe("Terminal discovery unavailable.");
      expect(view.result.current.tabs).toEqual([]);
      expect(terminalList).toHaveBeenCalledTimes(1);

      act(() => view.result.current.onRetryDiscovery());
      await waitFor(() => expect(view.result.current.isLoading).toBe(true), { timeout: 500 });
      expect(view.terminalCreate).not.toHaveBeenCalled();
      await act(async () => {
        retry.resolve(result);
        await retry.promise;
      });
      await waitFor(
        () => expect(view.result.current.tabs[0]?.terminalId).toBe(terminal.terminalId),
        {
          timeout: 500,
        },
      );
      expect(view.result.current.discoveryError).toBeNull();
      expect(view.result.current.isLoading).toBe(false);
      expect(view.result.current.tabs).toHaveLength(1);
      expect(terminalList).toHaveBeenCalledTimes(2);
      expect(view.terminalCreate).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  test.each([
    { name: "existing tabs", hasTabs: true },
    { name: "an empty list", hasTabs: false },
  ])("keeps $name after a failed refresh", async ({ hasTabs }) => {
    const terminalList = mock(async () => ({
      hostInstanceId: "host-1",
      terminals: hasTabs ? [existingTerminal()] : [],
    }));
    const view = renderModel(terminalList);
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      expect(view.result.current.tabs).toHaveLength(hasTabs ? 1 : 0);
      const tabs = view.result.current.tabs;
      const mountedTabs = view.result.current.mountedTabs;
      const controller = view.result.current.controller;
      terminalList.mockRejectedValueOnce(new Error("Terminal refresh unavailable."));

      act(() => view.result.current.onRetryDiscovery());
      await waitFor(
        () => expect(view.result.current.discoveryError).toBe("Terminal refresh unavailable."),
        {
          timeout: 500,
        },
      );
      expect(view.result.current.isLoading).toBe(false);
      expect(view.result.current.tabs).toEqual(tabs);
      expect(view.result.current.mountedTabs).toEqual(mountedTabs);
      expect(view.result.current.controller).toBe(controller);
      expect(view.terminalCreate).not.toHaveBeenCalled();
      expect(terminalList).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  test("keeps Workspace Session tabs separate through switches and a renderer remount", async () => {
    const unavailable = createUnavailableShellBridge();
    const terminals: TerminalSummary[] = [
      {
        terminalId: "task-terminal",
        label: "Task",
        context: { repoPath: "/repo", taskId: "task" },
        initialWorkingDir: "/repo",
        createdAt: "2026-07-19T00:00:00.000Z",
        lifecycle: "running",
        exit: null,
        startedBy: "user",
      },
    ];
    const filters: string[] = [];
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: {
        ...unavailable.client,
        systemGetPlatform: async () => "darwin",
        terminalList: async ({ filter }) => {
          filters.push(JSON.stringify(filter));
          return {
            hostInstanceId: "host-1",
            terminals: terminals.filter(
              (entry) =>
                filter.kind === "workspace_session" &&
                "kind" in entry.context &&
                entry.context.workspaceId === filter.workspaceId &&
                entry.context.sessionId === filter.sessionId,
            ),
          };
        },
        terminalCreate: async (request) => {
          const terminalId = `session-terminal-${terminals.length}`;
          const summary: TerminalSummary = {
            terminalId,
            label: request.workingDir,
            context: request.context,
            initialWorkingDir: request.workingDir,
            createdAt: "2026-07-19T00:00:00.000Z",
            lifecycle: "running",
            exit: null,
            startedBy: "user",
          };
          terminals.push(summary);
          return { ref: { terminalId }, summary };
        },
      },
      terminalBridge: {
        connect: async (_onFrame, onStateChange) => {
          onStateChange("connected");
          return { send: async () => undefined, close: () => undefined };
        },
      },
    };
    let latest: ReturnType<typeof useTerminals> | null = null;
    const Harness = ({ sessionId }: { sessionId: string | null }) => {
      latest = useTerminals(
        {
          scope: sessionId
            ? {
                key: `workspace-1:${sessionId}`,
                context: {
                  kind: "workspace_session",
                  workspaceId: "workspace-1",
                  sessionId,
                  repoPath: "/repo",
                },
                workingDirectory: sessionId === "first" ? "/repo" : "/worktree",
                workingDirectoryError: "Missing chat directory.",
              }
            : null,
          isScopeLoading: false,
          mountedScopeKeys: ["workspace-1:first", "workspace-1:second"],
        },
        dependencies,
      );
      return null;
    };
    const getLatest = () => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness sessionId="first" />
      </QueryProvider>,
    );
    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      act(() => {
        getLatest().createTerminal();
      });
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-1"));
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness sessionId="second" />
        </QueryProvider>,
      );
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      expect(getLatest().tabs).toEqual([]);
      act(() => {
        getLatest().createTerminal();
      });
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-2"));
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness sessionId="first" />
        </QueryProvider>,
      );
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-1"));
      expect(getLatest().mountedTabs).toHaveLength(2);
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness sessionId={null} />
        </QueryProvider>,
      );
      expect(getLatest().isAvailable).toBe(false);
      expect(getLatest().tabs).toEqual([]);
    } finally {
      view.unmount();
    }
    const restored = render(
      <QueryProvider useIsolatedClient>
        <Harness sessionId="second" />
      </QueryProvider>,
    );
    try {
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-2"));
      expect(getLatest().tabs).toHaveLength(1);
      expect(filters).not.toContain(JSON.stringify({ kind: "all" }));
    } finally {
      restored.unmount();
    }
  });

  test("blocks a new start while discovery runs or failed", async () => {
    const discovery = Promise.withResolvers<TerminalListResponse>();
    const view = renderModel(mock(() => discovery.promise));
    try {
      expect(view.result.current.startBlockedReason).toBe("Terminals are loading.");

      await act(async () => {
        discovery.reject(new Error("Discovery failed."));
        await discovery.promise.catch(() => undefined);
      });

      await waitFor(
        () =>
          expect(view.result.current.startBlockedReason).toBe(
            "Terminal discovery failed. Retry it in the bottom panel.",
          ),
        { timeout: 500 },
      );
    } finally {
      view.unmount();
    }
  });

  test("blocks a new start at the terminal limit", async () => {
    const terminals = Array.from({ length: 8 }, (_, index) => ({
      ...existingTerminal(),
      terminalId: `terminal-${index}`,
    }));
    const view = renderModel(mock(async () => ({ hostInstanceId: "host-1", terminals })));
    try {
      await waitFor(() => expect(view.result.current.tabs).toHaveLength(8), { timeout: 500 });
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });

      expect(view.result.current.startBlockedReason).toBe(
        "Close a terminal to start another. The limit is 8 terminals.",
      );
    } finally {
      view.unmount();
    }
  });

  test("runs an action in a new tab and reads the host list again", async () => {
    const terminal = { ...existingTerminal(), terminalId: "action-terminal", label: "bun test" };
    let terminals: TerminalSummary[] = [];
    const terminalList = mock(async () => ({
      hostInstanceId: "host-1",
      terminals: [...terminals],
    }));
    const view = renderModel(terminalList);
    const run = Promise.withResolvers<{ ref: { terminalId: string }; summary: TerminalSummary }>();
    view.terminalRunAction.mockImplementation(() => run.promise);
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      expect(view.result.current.startBlockedReason).toBeNull();
      const listCalls = terminalList.mock.calls.length;

      const started: StartedTerminal = { tabId: null };
      act(() => {
        started.tabId = view.result.current.createTerminal(testAction());
      });

      expect(view.result.current.tabs).toHaveLength(1);
      const [pendingTab] = view.result.current.tabs;
      expect(pendingTab?.requestState).toBe("creating");
      expect(pendingTab && "label" in pendingTab ? pendingTab.label : null).toBe("Run tests");
      expect(pendingTab?.tabId).toBe(started.tabId ?? "missing");
      // A second click on the action control cannot run the command again before this start ends.
      expect(view.result.current.startBlockedReason).toBe("A terminal is starting.");
      expect(view.terminalRunAction).toHaveBeenCalledWith({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
        actionId: "action-test",
      });
      expect(view.terminalCreate).not.toHaveBeenCalled();

      await act(async () => {
        terminals = [terminal];
        run.resolve({ ref: { terminalId: terminal.terminalId }, summary: terminal });
        await run.promise;
      });
      await waitFor(() => expect(view.result.current.tabs[0]?.terminalId).toBe("action-terminal"), {
        timeout: 500,
      });
      expect(view.result.current.tabs).toHaveLength(1);
      expect(terminalList.mock.calls.length).toBeGreaterThan(listCalls);
    } finally {
      view.unmount();
    }
  });

  test("shows a failed action tab and retries the same action", async () => {
    const terminal = { ...existingTerminal(), terminalId: "action-terminal" };
    const view = renderModel(async () => ({ hostInstanceId: "host-1", terminals: [] }));
    view.terminalRunAction
      .mockImplementationOnce(async () => {
        throw new HostTerminalClientError(
          { code: "action_not_found", message: "The action lint does not exist." },
          null,
        );
      })
      .mockImplementationOnce(async () => ({
        ref: { terminalId: terminal.terminalId },
        summary: terminal,
      }));
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      act(() => {
        view.result.current.createTerminal(testAction({ id: "lint", name: "Lint" }));
      });
      await waitFor(
        () => expect(view.result.current.tabs[0]?.error).toBe("The action lint does not exist."),
        { timeout: 500 },
      );
      const failedTab = view.result.current.tabs[0];
      if (failedTab?.requestState !== "creation_failed") throw new Error("Expected a failed tab.");

      await act(async () =>
        view.result.current.onRetryCreate("/repo:task-1", failedTab.tabId, failedTab.actionId),
      );

      await waitFor(() => expect(view.result.current.tabs[0]?.terminalId).toBe("action-terminal"), {
        timeout: 500,
      });
      expect(view.terminalRunAction).toHaveBeenCalledTimes(2);
      expect(view.terminalRunAction.mock.calls[1]?.[0]).toMatchObject({ actionId: "lint" });
      expect(view.terminalCreate).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  test("blocks an action with the scope reason when the scope has no working directory", async () => {
    const view = renderModel(async () => ({ hostInstanceId: "host-1", terminals: [] }), null);
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      expect(view.result.current.startBlockedReason).toBe("Task task-1 has no available worktree.");

      act(() => {
        expect(view.result.current.createTerminal(testAction())).toBeNull();
      });

      expect(view.result.current.tabs).toEqual([]);
      expect(view.terminalRunAction).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  test("commits the terminal consumer once when the scope changes", async () => {
    const unavailable = createUnavailableShellBridge();
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: {
        ...unavailable.client,
        systemGetPlatform: async () => "darwin",
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
      },
      terminalBridge: {
        connect: async (_onFrame, onStateChange) => {
          onStateChange("connected");
          return { send: async () => undefined, close: () => undefined };
        },
      },
    };
    let consumerCommits = 0;
    let latest: ReturnType<typeof useTerminals> | null = null;
    const getLatest = (): ReturnType<typeof useTerminals> => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const TerminalConsumer = () => {
      useLayoutEffect(() => {
        consumerCommits += 1;
      });
      return null;
    };
    const Harness = ({ scopeKey }: { scopeKey: string }) => {
      latest = useTerminals(
        {
          scope: {
            key: scopeKey,
            context: { repoPath: "/repo", taskId: scopeKey },
            workingDirectory: "/repo",
            workingDirectoryError: "The working directory is unavailable.",
          },
          isScopeLoading: false,
          mountedScopeKeys: [scopeKey],
        },
        dependencies,
      );
      return <TerminalConsumer />;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness scopeKey="scope-a" />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness scopeKey="scope-b" />
        </QueryProvider>,
      );
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness scopeKey="scope-a" />
        </QueryProvider>,
      );
      consumerCommits = 0;

      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness scopeKey="scope-b" />
        </QueryProvider>,
      );

      expect(getLatest().scopeKey).toBe("scope-b");
      expect(consumerCommits).toBe(1);
    } finally {
      view.unmount();
    }
  });
});

function existingTerminal(): TerminalSummary {
  return {
    terminalId: "existing-terminal",
    label: "Existing shell",
    context: { repoPath: "/repo", taskId: "task-1" },
    initialWorkingDir: "/repo",
    createdAt: "2026-07-19T00:00:00.000Z",
    lifecycle: "running",
    exit: null,
    startedBy: "user",
  };
}

function renderModel(
  terminalList: TerminalDependencies["hostClient"]["terminalList"],
  workingDirectory: string | null = "/repo",
) {
  const unavailable = createUnavailableShellBridge();
  const terminalCreate = mock(unavailable.client.terminalCreate);
  const terminalRunAction = mock(unavailable.client.terminalRunAction);
  const dependencies: TerminalDependencies = {
    hostClient: {
      ...unavailable.client,
      systemGetPlatform: async () => "darwin",
      terminalList,
      terminalCreate,
      terminalRunAction,
    },
    terminalBridge: {
      connect: async (_onFrame, onStateChange) => {
        onStateChange("connected");
        return { send: async () => undefined, close: () => undefined };
      },
    },
  };
  const view = renderHook(
    ({ scope, isScopeLoading }: { scope: TerminalScope; isScopeLoading: boolean }) =>
      useTerminals(
        {
          scope,
          isScopeLoading,
          mountedScopeKeys: [scope.key],
        },
        dependencies,
      ),
    {
      initialProps: {
        scope: {
          key: "/repo:task-1",
          context: { repoPath: "/repo", taskId: "task-1" },
          workingDirectory,
          workingDirectoryError: "Task task-1 has no available worktree.",
        },
        isScopeLoading: false,
      },
      wrapper: IsolatedQueryWrapper,
    },
  );
  return { ...view, terminalCreate, terminalRunAction };
}

function testAction(overrides: Partial<RepoAction> = {}): RepoAction {
  return {
    id: "action-test",
    icon: "test",
    name: "Run tests",
    command: "bun test",
    runOnWorktreeCreate: false,
    waitBeforeAgentStart: false,
    ...overrides,
  };
}
