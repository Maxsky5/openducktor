import { expect, spyOn, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import {
  createSessionPanelFixture,
  createTerminalSessionsFixture,
} from "@/test-utils/session-panel-fixtures";
import type { TerminalSummary } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { terminalQueryKeys } from "@openducktor/frontend-core/queries/terminals";
import { QueryProvider } from "@/test-utils/query-provider";
import { useTerminals, type TerminalTab } from "@/features/terminals";
import * as transport from "@/features/terminals/use-terminal-transport";
import { sessionPanelOwnerKey, useSessionPanels } from ".";
import { SessionTerminalHost, SessionTerminalSurface } from "./session-terminal-host";
import { SessionViewContext } from "../session-navigation/session-view-context";

test("task views share one viewport through owner eviction and panel closure", () => {
  const scopeKey = "task";
  const tab: TerminalTab = {
    tabId: "shell",
    terminalId: "shell",
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
    summary: {
      terminalId: "shell",
      label: "Shell",
      context: { repoPath: "/repo", taskId: "task" },
      initialWorkingDir: "/repo",
      createdAt: "2026-10-18T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
      startedBy: "user",
    },
  };
  const model = createSessionPanelFixture({
    selectedTabId: tab.tabId,
    terminals: createTerminalSessionsFixture({ scopeKey }),
    terminalMounts: [{ key: "terminal", scopeKey, tab, value: tab.tabId }],
    activeTerminalKey: "terminal",
  });
  const content = (ids: string[], active: string, panelOpen = true) => (
    <SessionTerminalHost viewIds={ids} activeViewId={active}>
      {ids.map((id) => (
        <SessionViewContext key={id} value={{ id, isActive: id === active }}>
          <div data-testid={id}>{panelOpen && <SessionTerminalSurface model={model} />}</div>
        </SessionViewContext>
      ))}
    </SessionTerminalHost>
  );
  const view = render(content(["planner", "build"], "planner"));
  try {
    const viewport = view.container.querySelector("[data-terminal-viewport]");
    expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1);
    expect(view.getByTestId("planner").contains(viewport)).toBe(true);
    view.rerender(content(["planner", "build"], "build"));
    expect(view.getByTestId("build").contains(viewport)).toBe(true);
    view.rerender(content(["build"], "build"));
    expect(viewport?.isConnected).toBe(true);
    view.rerender(content(["build"], "build", false));
    expect(viewport?.isConnected).toBe(true);
    expect(viewport?.getAttribute("data-viewport-state")).toBe("inactive");
    view.rerender(content(["build"], "build"));
    expect(view.getByTestId("build").contains(viewport)).toBe(true);
    expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1);
    view.rerender(content([], "none"));
    expect(viewport?.isConnected).toBe(false);
  } finally {
    view.unmount();
  }
});

test.each(["discovered", "created", "stale-failed", "evict-created"] as const)(
  "a first task-role visit keeps the terminal viewport and live state: %s",
  async (mode) => {
    const transportStub = spyOn(transport, "useTerminalTransport").mockReturnValue({
      controller: null,
      transportError: null,
    });
    const owner = { kind: "task", workspaceId: `roles-${mode}`, taskId: "task" } as const;
    const key = sessionPanelOwnerKey(owner);
    const scope = {
      key,
      context: { repoPath: `/repo-${mode}`, taskId: "task" },
      workingDirectory: "/repo",
      workingDirectoryError: "Missing directory",
    };
    const summary: TerminalSummary = {
      terminalId: "shell",
      label: "Shell",
      context: scope.context,
      initialWorkingDir: "/repo",
      createdAt: "2026-10-18T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
      startedBy: "user",
    };
    let summaries = mode.includes("created") ? [] : [summary];
    let fail = false;
    const connection = createTestClientConnection({
      client: {
        terminalList: async () => {
          if (fail) throw new Error("Discovery failed");
          return { hostInstanceId: "host", terminals: summaries };
        },
        terminalCreate: async () => {
          summaries = [summary];
          return { ref: { terminalId: summary.terminalId }, summary };
        },
        systemGetPlatform: async () => "darwin",
      },
    });
    connection.queryClient.setQueryData(terminalQueryKeys.task(scope.context), {
      hostInstanceId: "host",
      terminals: summaries,
    });
    const models = new Map<string, ReturnType<typeof useTerminals>>();
    const model = (id: string) => {
      const result = models.get(id);
      if (!result) throw new Error(`Missing terminal model: ${id}`);
      return result;
    };
    function Conversation({ id }: { id: "planner" | "build" }) {
      const terminals = useTerminals({ scope, isScopeLoading: false });
      models.set(id, terminals);
      const panels = useSessionPanels({ owner, selectionKey: id, terminals });
      return <SessionTerminalSurface model={panels.bottom} />;
    }
    const content = (ids: Array<"planner" | "build">, active: string) => (
      <QueryProvider connection={connection}>
        <SessionTerminalHost viewIds={ids} activeViewId={active}>
          {ids.map((id) => (
            <SessionViewContext key={id} value={{ id, isActive: id === active }}>
              <Conversation id={id} />
            </SessionViewContext>
          ))}
        </SessionTerminalHost>
      </QueryProvider>
    );
    const view = render(content(["planner"], "planner"));
    try {
      await waitFor(() => expect(model("planner").isLoading).toBe(false));
      if (mode.includes("created"))
        await act(async () => {
          expect(model("planner").createTerminal()).not.toBeNull();
        });
      await waitFor(() => expect(model("planner").tabs[0]?.terminalId).toBe(summary.terminalId));
      if (mode === "stale-failed") {
        act(() => model("planner").onLifecycle(key, summary.terminalId, "exited"));
        fail = true;
      }
      const original = view.container.querySelector("[data-terminal-viewport]");
      const tabId = model("planner").tabs[0]?.tabId;
      expect(original).not.toBeNull();
      await act(async () =>
        view.rerender(
          content(mode === "evict-created" ? ["build"] : ["planner", "build"], "build"),
        ),
      );
      await waitFor(() => expect(model("build").isSynced).toBe(true));
      expect(original?.isConnected).toBe(true);
      expect(view.container.querySelector("[data-terminal-viewport]")).toBe(original);
      expect(model("build").tabs[0]?.tabId).toBe(tabId);
      if (mode === "stale-failed") {
        await waitFor(() => expect(model("build").discoveryError).toBe("Discovery failed"));
        expect(model("build").tabs[0]?.summary?.lifecycle).toBe("exited");
      }
    } finally {
      view.unmount();
      transportStub.mockRestore();
      await connection.dispose();
    }
  },
);
