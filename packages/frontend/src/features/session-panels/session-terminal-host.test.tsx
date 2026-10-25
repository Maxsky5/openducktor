import { expect, spyOn, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import { Profiler, useState } from "react";
import {
  createSessionPanelFixture,
  createTerminalSessionsFixture,
} from "@/test-utils/session-panel-fixtures";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalSummary,
} from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { terminalQueryKeys } from "@openducktor/frontend-core/queries/terminals";
import { QueryProvider } from "@/test-utils/query-provider";
import { useTerminals, type TerminalTab } from "@/features/terminals";
import * as terminalLayer from "@/features/terminals/terminal-layer";
import type { TerminalBridge } from "@/lib/shell-bridge";
import { SessionPanel, sessionPanelOwnerKey, useSessionPanels } from ".";
import { SessionTerminalHost, SessionTerminalSurface } from "./session-terminal-host";
import {
  SessionViewContext,
  SessionViewShownContext,
} from "../session-navigation/session-view-context";

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

test("task views share one viewport from the first shown frame through eviction and panel closure", () => {
  const model = createSessionPanelFixture({
    panel: "bottom",
    tabs: [{ id: tab.tabId, kind: "terminal", terminal: tab }],
    selectedTabId: tab.tabId,
    terminals: createTerminalSessionsFixture({ scopeKey }),
    terminalMounts: [{ key: "terminal", scopeKey, tab, value: tab.tabId }],
    activeTerminalKey: "terminal",
  });
  const content = (ids: string[], active: string, panelOpen = true, shown = active) => (
    <QueryProvider>
      <SessionTerminalHost viewIds={ids}>
        {ids.map((id) => (
          <SessionViewContext key={id} value={{ id, isActive: id === active }}>
            <SessionViewShownContext value={id === shown}>
              <div data-testid={id} style={{ display: id === shown ? undefined : "none" }}>
                {panelOpen && <SessionPanel model={model} />}
              </div>
            </SessionViewShownContext>
          </SessionViewContext>
        ))}
      </SessionTerminalHost>
    </QueryProvider>
  );
  const view = render(content(["planner", "build"], "planner"));
  try {
    const viewport = view.container.querySelector("[data-terminal-viewport]");
    expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1);
    expect(view.getByTestId("planner").contains(viewport)).toBe(true);
    // Retained session views show immediately, then change content activity after that paint.
    view.rerender(content(["planner", "build"], "planner", true, "build"));
    expect(view.getByTestId("build").contains(viewport)).toBe(true);
    expect(viewport?.getAttribute("data-viewport-state")).toBe("active");
    expect(viewport?.hasAttribute("inert")).toBe(true);
    view.rerender(content(["planner", "build"], "build"));
    expect(view.getByTestId("build").contains(viewport)).toBe(true);
    expect(viewport?.hasAttribute("inert")).toBe(false);
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

test("a surface update that keeps its terminals does not render the host again", () => {
  const model = createSessionPanelFixture({
    selectedTabId: tab.tabId,
    terminals: createTerminalSessionsFixture({ scopeKey }),
    terminalMounts: [{ key: "terminal", scopeKey, tab, value: tab.tabId }],
    activeTerminalKey: "terminal",
  });
  let renderAgain = () => {};
  function View() {
    const [, setRenders] = useState(0);
    renderAgain = () => setRenders((renders) => renders + 1);
    // A new context value on each render runs the surface update again.
    return (
      <SessionViewContext value={{ id: "planner", isActive: true }}>
        <SessionTerminalSurface model={model} />
      </SessionViewContext>
    );
  }
  let commits = 0;
  const view = render(
    <Profiler id="host" onRender={() => (commits += 1)}>
      <SessionTerminalHost viewIds={["planner"]}>
        <View />
      </SessionTerminalHost>
    </Profiler>,
  );
  try {
    const before = commits;
    act(() => renderAgain());
    expect(commits - before).toBe(1);
  } finally {
    view.unmount();
  }
});

test("a panel render with the same terminals does not render its terminals again", () => {
  const model = createSessionPanelFixture({
    panel: "bottom",
    tabs: [{ id: tab.tabId, kind: "terminal", terminal: tab }],
    selectedTabId: tab.tabId,
    terminals: createTerminalSessionsFixture({ scopeKey }),
    terminalMounts: [{ key: "terminal", scopeKey, tab, value: tab.tabId }],
    activeTerminalKey: "terminal",
  });
  let renderAgain = () => {};
  function View() {
    const [renders, setRenders] = useState(0);
    renderAgain = () => setRenders((count) => count + 1);
    // Pages give new tool tabs on each render.
    return (
      <SessionViewContext value={{ id: "planner", isActive: true }}>
        <SessionPanel model={model} toolTabs={{ diffs: { content: renders } }} />
      </SessionViewContext>
    );
  }
  const layer = spyOn(terminalLayer, "TerminalLayer");
  const view = render(
    <QueryProvider>
      <SessionTerminalHost viewIds={["planner"]}>
        <View />
      </SessionTerminalHost>
    </QueryProvider>,
  );
  try {
    const before = layer.mock.calls.length;
    act(() => renderAgain());
    expect(layer.mock.calls.length - before).toBe(0);
  } finally {
    view.unmount();
    layer.mockRestore();
  }
});

test("a terminal tab and its moved content link to each other in each kept view", () => {
  const panelOf = (tabIdBase: string) =>
    createSessionPanelFixture({
      panel: "bottom",
      tabIdBase,
      tabs: [{ id: tab.tabId, kind: "terminal", terminal: tab }],
      selectedTabId: tab.tabId,
      terminals: createTerminalSessionsFixture({ scopeKey }),
      terminalMounts: [{ key: "terminal", scopeKey, tab, value: tab.tabId }],
      activeTerminalKey: "terminal",
    });
  const panels = { planner: panelOf("planner-panel"), build: panelOf("build-panel") };
  const content = (active: keyof typeof panels) => (
    <QueryProvider>
      <SessionTerminalHost viewIds={["planner", "build"]}>
        {(["planner", "build"] as const).map((id) => (
          <SessionViewContext key={id} value={{ id, isActive: id === active }}>
            <SessionViewShownContext value={id === active}>
              <SessionPanel model={panels[id]} />
            </SessionViewShownContext>
          </SessionViewContext>
        ))}
      </SessionTerminalHost>
    </QueryProvider>
  );
  const expectLinkedTerminal = () => {
    const trigger = view.getByRole("tab");
    const content = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(content?.hasAttribute("data-terminal-viewport")).toBe(true);
    expect(content?.getAttribute("aria-labelledby")).toBe(trigger.id);
  };
  const view = render(content("planner"));
  try {
    expectLinkedTerminal();
    view.rerender(content("build"));
    expectLinkedTerminal();
  } finally {
    view.unmount();
  }
});

test("the terminal surface adds no box above the panel tab content", () => {
  const model = createSessionPanelFixture({
    terminals: createTerminalSessionsFixture({ scopeKey: "task" }),
  });
  const view = render(
    <SessionTerminalHost viewIds={["view"]}>
      <SessionViewContext value={{ id: "view", isActive: true }}>
        <div data-testid="panel-body">
          <SessionTerminalSurface model={model} />
        </div>
      </SessionViewContext>
    </SessionTerminalHost>,
  );
  try {
    const body = view.getByTestId("panel-body");
    const layer = view.getByTestId("terminal-layer");
    expect(body.contains(layer)).toBe(true);
    // Only the terminal layer can cover the tabs, and it passes input through with no active terminal.
    expect(layer.getAttribute("data-active")).toBe("false");
    let element = layer.parentElement;
    while (element && element !== body) {
      expect(element.classList.contains("contents")).toBe(true);
      element = element.parentElement;
    }
  } finally {
    view.unmount();
  }
});

test.each(["discovered", "created", "stale-failed", "evict-created"] as const)(
  "a first task-role visit keeps the terminal viewport and live state: %s",
  async (mode) => {
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
    const sent: string[] = [];
    let connections = 0;
    let disconnections = 0;
    const terminalBridge: TerminalBridge = {
      connect: async (onFrame) => {
        connections += 1;
        return {
          send: async (frame) => {
            const { message } = decodeTerminalProtocolFrame(frame);
            sent.push(message.type);
            if (message.type === "attach")
              onFrame(
                encodeTerminalProtocolFrame({
                  message: {
                    version: TERMINAL_PROTOCOL_VERSION,
                    type: "snapshot",
                    terminalId: summary.terminalId,
                    earliestRetainedSequence: 0,
                    snapshotSequenceEnd: 0,
                    lifecycle: "running",
                    title: summary.label,
                    complete: true,
                  },
                  payload: new Uint8Array(),
                }),
              );
          },
          close: () => {
            disconnections += 1;
          },
        };
      },
    };
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
    type Role = "build" | "qa" | "planner" | "spec";
    const model = (id: string) => {
      const result = models.get(id);
      if (!result) throw new Error(`Missing terminal model: ${id}`);
      return result;
    };
    function Conversation({ id }: { id: Role }) {
      const terminals = useTerminals(
        { scope, isScopeLoading: false },
        { hostClient: connection.host.client, terminalBridge },
      );
      models.set(id, terminals);
      const panels = useSessionPanels({ owner, selectionKey: id, terminals });
      return <SessionTerminalSurface model={panels.bottom} />;
    }
    const content = (ids: Role[], active: Role) => (
      <QueryProvider connection={connection}>
        <SessionTerminalHost viewIds={ids}>
          {ids.map((id) => (
            <SessionViewContext key={id} value={{ id, isActive: id === active }}>
              <SessionViewShownContext value={id === active}>
                <Conversation id={id} />
              </SessionViewShownContext>
            </SessionViewContext>
          ))}
        </SessionTerminalHost>
      </QueryProvider>
    );
    const view = render(content(["build"], "build"));
    try {
      await waitFor(() => expect(model("build").isLoading).toBe(false));
      if (mode.includes("created"))
        await act(async () => {
          expect(model("build").createTerminal()).not.toBeNull();
        });
      await waitFor(() => expect(model("build").tabs[0]?.terminalId).toBe(summary.terminalId));
      await waitFor(() => expect(sent.filter((type) => type === "attach")).toHaveLength(1));
      const renderer = view.container.querySelector(".xterm-screen");
      const application = view.getByRole("application");
      expect(renderer).not.toBeNull();
      expect(application.classList.contains("invisible")).toBe(false);
      if (mode === "stale-failed") {
        act(() => model("build").onLifecycle(key, summary.terminalId, "exited"));
        fail = true;
      }
      const original = view.container.querySelector("[data-terminal-viewport]");
      const tabId = model("build").tabs[0]?.tabId;
      expect(original).not.toBeNull();
      const ids: Role[] = ["build"];
      for (const role of ["qa", "planner", "spec"] as const) {
        ids.push(role);
        await act(async () =>
          view.rerender(content(mode === "evict-created" ? [role] : ids, role)),
        );
        await waitFor(() => expect(model(role).isSynced).toBe(true));
        expect(original?.isConnected).toBe(true);
        expect(view.container.querySelector("[data-terminal-viewport]")).toBe(original);
        expect(renderer?.isConnected).toBe(true);
        expect(view.container.querySelector(".xterm-screen") === renderer).toBe(true);
        expect(view.getByRole("application") === application).toBe(true);
        expect(model(role).tabs[0]?.tabId).toBe(tabId);
        expect(connections).toBe(1);
        expect(disconnections).toBe(0);
        expect(sent.filter((type) => type === "attach")).toHaveLength(1);
        expect(sent).not.toContain("detach");
        if (mode === "stale-failed") {
          await waitFor(() => expect(model(role).discoveryError).toBe("Discovery failed"));
          expect(model(role).tabs[0]?.summary?.lifecycle).toBe("exited");
        }
      }
    } finally {
      view.unmount();
      await connection.dispose();
    }
  },
);
