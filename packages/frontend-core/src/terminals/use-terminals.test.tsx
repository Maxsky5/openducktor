import "../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { RepoAction, TerminalListResponse, TerminalSummary } from "@openducktor/contracts";
import {
  createHostClient,
  type HostClient,
  HostTerminalClientError,
} from "@openducktor/host-client";
import { remoteError } from "@openducktor/host-client/remote";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { type PropsWithChildren, useLayoutEffect } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { createTestClientConnection } from "../test-support/test-client-connection";
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
    const unavailable = createUnavailableHost();
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
    const hostReads: Partial<HostClient> = {
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
    };
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: {
        ...unavailable.client,
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
        },
        dependencies,
      );
      return null;
    };
    const getLatest = () => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const connection = createTestClientConnection({ client: hostReads });
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <Harness sessionId="first" />
      </ClientConnectionProvider>,
    );
    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      act(() => {
        getLatest().createTerminal();
      });
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-1"));
      view.rerender(
        <ClientConnectionProvider connection={connection}>
          <Harness sessionId="second" />
        </ClientConnectionProvider>,
      );
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      expect(getLatest().tabs).toEqual([]);
      act(() => {
        getLatest().createTerminal();
      });
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-2"));
      view.rerender(
        <ClientConnectionProvider connection={connection}>
          <Harness sessionId="first" />
        </ClientConnectionProvider>,
      );
      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("session-terminal-1"));
      expect(getLatest().mountedTabs).toHaveLength(1);
      view.rerender(
        <ClientConnectionProvider connection={connection}>
          <Harness sessionId={null} />
        </ClientConnectionProvider>,
      );
      expect(getLatest().isAvailable).toBe(false);
      expect(getLatest().tabs).toEqual([]);
    } finally {
      view.unmount();
    }
    // The remount gets a new query cache, so it reads the host list again.
    const restoredConnection = createTestClientConnection({ client: hostReads });
    const restored = render(
      <ClientConnectionProvider connection={restoredConnection}>
        <Harness sessionId="second" />
      </ClientConnectionProvider>,
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
            "Terminal discovery failed. Retry terminal discovery.",
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

  test("marks a start with a lost result and reads the host list instead of starting again", async () => {
    const terminal = { ...existingTerminal(), terminalId: "maybe-started" };
    let terminals: TerminalSummary[] = [];
    const terminalList = mock(async () => ({
      hostInstanceId: "host-1",
      terminals: [...terminals],
    }));
    const view = renderModel(terminalList);
    view.terminalCreate.mockImplementation(async () => {
      terminals = [terminal];
      throw remoteError("outcome_unknown", "The host result was lost.", "Check the terminal list.");
    });
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      act(() => {
        view.result.current.createTerminal();
      });
      await waitFor(
        () =>
          expect(view.result.current.tabs.map((tab) => tab.terminalId)).toContain("maybe-started"),
        { timeout: 500 },
      );
      const failedTab = view.result.current.tabs.find((tab) => tab.terminalId === null);
      expect(failedTab).toMatchObject({ requestState: "creation_failed", outcomeUnknown: true });
      expect(failedTab?.error).toBe("The host result was lost. Check the terminal list.");
      if (!failedTab) throw new Error("Expected the failed tab.");

      await act(async () =>
        view.result.current.onRetryCreate("/repo:task-1", failedTab.tabId, null),
      );

      expect(view.terminalCreate).toHaveBeenCalledTimes(1);
      expect(view.terminalRunAction).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  test("shows a failed scope read as a discovery error and reads the scope again on retry", async () => {
    const readError = "Could not read the worktree of task task-1: The host is offline.";
    const retryScope = mock(() => {});
    const terminalList = mock(async () => ({ hostInstanceId: "host-1", terminals: [] }));
    const view = renderModel(terminalList, null, { scopeError: readError, retryScope });
    try {
      await waitFor(() => expect(view.result.current.isLoading).toBe(false), { timeout: 500 });
      expect(view.result.current.discoveryError).toBe(readError);

      act(() => view.result.current.onRetryDiscovery());

      expect(retryScope).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(2), { timeout: 500 });
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
    const unavailable = createUnavailableHost();
    const connection = createTestClientConnection({
      client: {
        systemGetPlatform: async () => "darwin",
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
      },
    });
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: unavailable.client,
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
        },
        dependencies,
      );
      return <TerminalConsumer />;
    };
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <Harness scopeKey="scope-a" />
      </ClientConnectionProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      view.rerender(
        <ClientConnectionProvider connection={connection}>
          <Harness scopeKey="scope-b" />
        </ClientConnectionProvider>,
      );
      view.rerender(
        <ClientConnectionProvider connection={connection}>
          <Harness scopeKey="scope-a" />
        </ClientConnectionProvider>,
      );
      consumerCommits = 0;

      view.rerender(
        <ClientConnectionProvider connection={connection}>
          <Harness scopeKey="scope-b" />
        </ClientConnectionProvider>,
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
  terminalList: HostClient["terminalList"],
  workingDirectory: string | null = "/repo",
  scopeLoad: { scopeError: string | null; retryScope: () => void } = {
    scopeError: null,
    retryScope: () => {},
  },
) {
  const unavailable = createUnavailableHost();
  const terminalCreate = mock(unavailable.client.terminalCreate);
  const terminalRunAction = mock(unavailable.client.terminalRunAction);
  const connection = createTestClientConnection({
    client: { systemGetPlatform: async () => "darwin", terminalList },
  });
  const dependencies: TerminalDependencies = {
    hostClient: {
      ...unavailable.client,
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
      useTerminals({ scope, isScopeLoading, ...scopeLoad }, dependencies),
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
      wrapper: ({ children }: PropsWithChildren) => (
        <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
      ),
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

/** A host whose commands fail until a test replaces them. */
function createUnavailableHost() {
  return {
    client: createHostClient(async (command) => {
      throw new Error(`The test host has no handler for '${command}'.`);
    }),
  };
}
