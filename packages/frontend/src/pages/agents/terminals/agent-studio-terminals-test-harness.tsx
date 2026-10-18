import type { TerminalSummary } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostClient } from "@openducktor/host-client";
import { render } from "@testing-library/react";
import { type ReactNode, useLayoutEffect, useMemo } from "react";
import {
  type ToolTabKind,
  type SessionPanelsModel,
  sessionPanelOwnerKey,
  useSessionPanels,
} from "@/features/session-panels";
import { SessionTerminalHost } from "@/features/session-panels/session-terminal-host";
import { SessionViewContext } from "@/features/session-navigation/session-view-context";
import type { TerminalSessionsModel, TerminalTab } from "@/features/terminals";
import { QueryProvider } from "@/test-utils/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { useAgentStudioTerminals } from "./use-agent-studio-terminals";

export const summaryForTask = (taskId: string): TerminalSummary => ({
  terminalId: `terminal-${taskId}`,
  label: "Shell 1",
  context: { repoPath: "/repo", taskId },
  initialWorkingDir: `/repo/worktrees/${taskId}`,
  createdAt: "2026-07-13T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
  startedBy: "user",
});

export const requireTab = (tab: TerminalTab | undefined): TerminalTab => {
  if (!tab) throw new Error("Expected a terminal tab.");
  return tab;
};

type AgentStudioTerminalDependencies = NonNullable<Parameters<typeof useAgentStudioTerminals>[1]>;

/**
 * The fake host of a terminal test. The harness gives the host reads to the test connection, and
 * the terminal commands and the terminal bridge to the hook.
 */
export type TerminalTestDependencies = {
  hostClient: AgentStudioTerminalDependencies["hostClient"] &
    Pick<HostClient, "systemGetPlatform" | "taskWorktreeGet" | "terminalList">;
  terminalBridge: AgentStudioTerminalDependencies["terminalBridge"];
};

export const createTerminalTestDependencies = (): TerminalTestDependencies => {
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

const WITHOUT_CI_CHECKS: ReadonlySet<ToolTabKind> = new Set(["ci_checks"]);

export type TaskTerminalPanels = { terminals: TerminalSessionsModel; panels: SessionPanelsModel };

type HarnessProps = {
  workspaceId: string;
  taskId: string;
  taskVersion: string | null;
  mountedTaskIds: readonly string[];
  children?: ((result: TaskTerminalPanels) => ReactNode) | undefined;
};

/**
 * Renders the task terminals with the session panels that place them, as the task page does. Each
 * harness uses its own workspace, so the shared panel layout store does not mix tests.
 */
export function renderTaskTerminalPanels(
  dependencies: TerminalTestDependencies,
  initial: Partial<HarnessProps> = {},
) {
  const { systemGetPlatform, taskWorktreeGet, terminalList, ...commands } = dependencies.hostClient;
  const connection = createTestClientConnection({
    client: { systemGetPlatform, taskWorktreeGet, terminalList },
  });
  const hookDependencies: AgentStudioTerminalDependencies = {
    hostClient: commands,
    terminalBridge: dependencies.terminalBridge,
  };
  let latest: TaskTerminalPanels | null = null;
  let props: HarnessProps = {
    workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
    taskId: "task-a",
    taskVersion: null,
    mountedTaskIds: [initial.taskId ?? "task-a"],
    ...initial,
  };
  function Harness({
    workspaceId,
    taskId,
    taskVersion,
    children,
    active,
  }: Omit<HarnessProps, "mountedTaskIds"> & { active: boolean }) {
    const terminals = useAgentStudioTerminals(
      { workspaceId, repoPath: "/repo", taskId, taskVersion },
      hookDependencies,
    );
    const owner = useMemo(
      () => ({ kind: "task" as const, workspaceId, taskId }),
      [taskId, workspaceId],
    );
    const panels = useSessionPanels({
      owner,
      selectionKey: "build",
      unavailableKinds: WITHOUT_CI_CHECKS,
      terminals,
    });
    const result = { terminals, panels };
    if (active) latest = result;
    // The page ends each panel slide when its transition ends. No transition runs in tests.
    const { right, bottom } = panels;
    useLayoutEffect(() => {
      for (const panel of [right, bottom]) {
        if (panel.presence === "opening" || panel.presence === "closing") panel.onSettled();
      }
    }, [bottom, right]);
    return children ? <>{children(result)}</> : null;
  }
  const element = () => (
    <QueryProvider connection={connection}>
      <SessionTerminalHost viewIds={props.mountedTaskIds} activeViewId={props.taskId}>
        {props.mountedTaskIds.map((taskId) => (
          <SessionViewContext
            key={taskId}
            value={{ id: taskId, isActive: taskId === props.taskId }}
          >
            <div
              style={{ display: taskId === props.taskId ? undefined : "none" }}
              inert={taskId !== props.taskId}
            >
              <Harness {...props} taskId={taskId} active={taskId === props.taskId} />
            </div>
          </SessionViewContext>
        ))}
      </SessionTerminalHost>
    </QueryProvider>
  );
  const view = render(element());
  const get = (): TaskTerminalPanels => {
    if (!latest) throw new Error("The terminal panels are not ready.");
    return latest;
  };
  return {
    terminals: (): TerminalSessionsModel => get().terminals,
    panels: (): SessionPanelsModel => get().panels,
    scopeKey: (taskId = props.taskId): string =>
      sessionPanelOwnerKey({ kind: "task", workspaceId: props.workspaceId, taskId }),
    update: (next: Partial<HarnessProps>): void => {
      props = {
        ...props,
        ...next,
        mountedTaskIds: next.mountedTaskIds ?? (next.taskId ? [next.taskId] : props.mountedTaskIds),
      };
      view.rerender(element());
    },
    unmount: view.unmount,
  };
}

/** The bottom panel tabs as terminal IDs, in order. */
export const bottomTerminalIds = (panels: SessionPanelsModel): (string | null)[] =>
  panels.bottom.tabs.map((tab) => (tab.kind === "terminal" ? tab.terminal.terminalId : null));

export const selectedBottomTerminal = (panels: SessionPanelsModel): TerminalTab | null => {
  const tab = panels.bottom.tabs.find((entry) => entry.id === panels.bottom.selectedTabId);
  return tab?.kind === "terminal" ? tab.terminal : null;
};

export const bottomEntryId = (panels: SessionPanelsModel, terminalId: string): string => {
  const tab = panels.bottom.tabs.find(
    (entry) => entry.kind === "terminal" && entry.terminal.terminalId === terminalId,
  );
  if (!tab) throw new Error(`Expected a bottom tab for ${terminalId}.`);
  return tab.id;
};
