import { describe, expect, mock, test } from "bun:test";
import type {
  TerminalCreateRequest,
  TerminalListResponse,
  TerminalSummary,
} from "@openducktor/contracts";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { useTerminals, type TerminalDependencies, type TerminalScope } from "./use-terminals";

describe("useTerminals", () => {
  test.each([
    { name: "empty initial discovery", refresh: false, hasTabs: false },
    { name: "initial discovery with existing terminals", refresh: false, hasTabs: true },
    { name: "an empty refresh", refresh: true, hasTabs: false },
    { name: "a refresh with existing terminals", refresh: true, hasTabs: true },
  ])("finishes opening the panel after $name", async ({ refresh, hasTabs }) => {
    const terminal = existingTerminal();
    let terminals: TerminalSummary[] = [];
    const discovery = Promise.withResolvers<TerminalListResponse>();
    const terminalList = mock(async () => ({
      hostInstanceId: "host-1",
      terminals: [...terminals],
    }));
    if (!refresh) terminalList.mockImplementationOnce(() => discovery.promise);
    const view = renderModel(terminalList);
    view.terminalCreate.mockImplementation(async () => {
      terminals = [terminal];
      return { ref: { terminalId: terminal.terminalId }, summary: terminal };
    });
    try {
      if (refresh) {
        await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
        terminalList.mockImplementationOnce(() => discovery.promise);
        act(() => view.result.current.onRetryDiscovery());
      }
      await waitFor(() => expect(view.result.current.isLoading).toBe(true), { timeout: 500 });
      act(() => view.result.current.onToggle());
      expect(view.result.current.isVisible).toBe(true);
      expect(view.terminalCreate).not.toHaveBeenCalled();

      await act(async () => {
        terminals = hasTabs ? [terminal] : [];
        discovery.resolve({ hostInstanceId: "host-1", terminals: [...terminals] });
        await discovery.promise;
      });
      await waitFor(
        () => expect(view.result.current.tabs[0]?.terminalId).toBe(terminal.terminalId),
        { timeout: 500 },
      );
      expect(view.terminalCreate).toHaveBeenCalledTimes(hasTabs ? 0 : 1);
      expect(view.result.current.tabs).toHaveLength(1);

      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      terminals = [];
      act(() => view.result.current.onRetryDiscovery());
      await waitFor(() => expect(view.result.current.tabs).toHaveLength(0), { timeout: 500 });
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      expect(view.result.current.isVisible).toBe(true);
      expect(view.terminalCreate).toHaveBeenCalledTimes(hasTabs ? 0 : 1);
    } finally {
      view.unmount();
    }
  });

  test.each(["hide", "toggle closed", "switch scope", "discovery failure"] as const)(
    "cancels pending terminal creation after %s",
    async (cancel) => {
      const empty: TerminalListResponse = { hostInstanceId: "host-1", terminals: [] };
      const discovery = Promise.withResolvers<TerminalListResponse>();
      const terminalList = mock(async () => empty).mockImplementationOnce(() => discovery.promise);
      const view = renderModel(terminalList);
      try {
        act(() => view.result.current.onToggle());
        expect(view.result.current.isVisible).toBe(true);
        expect(view.result.current.isLoading).toBe(true);
        expect(view.terminalCreate).not.toHaveBeenCalled();

        switch (cancel) {
          case "hide":
            act(() => view.result.current.onHide());
            break;
          case "toggle closed":
            act(() => view.result.current.onToggle());
            break;
          case "switch scope":
            view.rerender({
              scope: {
                key: "/repo:task-2",
                context: { repoPath: "/repo", taskId: "task-2" },
                workingDirectory: "/repo",
                workingDirectoryError: "The working directory is unavailable.",
              },
              isScopeLoading: false,
            });
            break;
          case "discovery failure":
            await act(async () => {
              discovery.reject(new Error("Discovery failed."));
              await discovery.promise.catch(() => undefined);
            });
            await waitFor(
              () => expect(view.result.current.discoveryError).toBe("Discovery failed."),
              {
                timeout: 500,
              },
            );
            act(() => view.result.current.onRetryDiscovery());
            break;
        }
        if (cancel !== "discovery failure") {
          await act(async () => {
            discovery.resolve(empty);
            await discovery.promise;
          });
        }
        await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
        expect(view.result.current.tabs).toEqual([]);
        expect(view.terminalCreate).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    },
  );

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
      act(() => view.result.current.onToggle());
      expect(view.terminalCreate).not.toHaveBeenCalled();
      expect(view.result.current.discoveryError).toBe("Terminal discovery unavailable.");
      expect(view.result.current.tabs).toEqual([]);
      expect(view.result.current.isVisible).toBe(true);
      expect(terminalList).toHaveBeenCalledTimes(1);

      act(() => view.result.current.onRetryDiscovery());
      await waitFor(() => expect(view.result.current.isLoading).toBe(true), { timeout: 500 });
      act(() => {
        view.result.current.onHide();
      });
      act(() => view.result.current.onToggle());
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
      const activeTabId = view.result.current.activeTabId;
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
      expect(view.result.current.activeTabId).toBe(activeTabId);
      expect(view.result.current.controller).toBe(controller);
      act(() => view.result.current.onHide());
      act(() => view.result.current.onToggle());
      expect(view.result.current.isVisible).toBe(true);
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
      act(() => getLatest().onCreate());
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-1"));
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness sessionId="second" />
        </QueryProvider>,
      );
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      expect(getLatest().tabs).toEqual([]);
      act(() => getLatest().onCreate());
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

  test("manages terminals for a non-task scope", async () => {
    const unavailable = createUnavailableShellBridge();
    const terminals: TerminalSummary[] = [];
    const listFilters: string[] = [];
    const createRequests: TerminalCreateRequest[] = [];
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: {
        ...unavailable.client,
        systemGetPlatform: async () => "darwin",
        terminalList: async ({ filter }) => {
          listFilters.push(filter.kind);
          return { hostInstanceId: "host-1", terminals: [...terminals] };
        },
        terminalCreate: async (request) => {
          createRequests.push(request);
          const summary: TerminalSummary = {
            terminalId: "terminal-free-chat",
            label: request.workingDir,
            context: request.context,
            initialWorkingDir: request.workingDir,
            createdAt: "2026-07-19T00:00:00.000Z",
            lifecycle: "running",
            exit: null,
          };
          terminals.push(summary);
          return { ref: { terminalId: summary.terminalId }, summary };
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
    const getLatest = (): ReturnType<typeof useTerminals> => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      latest = useTerminals(
        {
          scope: {
            key: "free-chat:chat-1",
            context: {},
            workingDirectory: "/repo",
            workingDirectoryError: "The chat working directory is unavailable.",
          },
          isScopeLoading: false,
          mountedScopeKeys: ["free-chat:chat-1"],
        },
        dependencies,
      );
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      expect(listFilters).toEqual(["unassociated"]);

      act(() => getLatest().onCreate());

      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("terminal-free-chat"));
      expect(createRequests).toEqual([{ workingDir: "/repo", context: {} }]);
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
            context: {},
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
  };
}

function renderModel(terminalList: TerminalDependencies["hostClient"]["terminalList"]) {
  const unavailable = createUnavailableShellBridge();
  const terminalCreate = mock(unavailable.client.terminalCreate);
  const dependencies: TerminalDependencies = {
    hostClient: {
      ...unavailable.client,
      systemGetPlatform: async () => "darwin",
      terminalList,
      terminalCreate,
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
          workingDirectory: "/repo",
          workingDirectoryError: "The working directory is unavailable.",
        },
        isScopeLoading: false,
      },
      wrapper: IsolatedQueryWrapper,
    },
  );
  return { ...view, terminalCreate };
}
