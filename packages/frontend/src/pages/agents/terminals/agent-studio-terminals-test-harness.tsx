import type { TerminalSummary } from "@openducktor/contracts";
import { render } from "@testing-library/react";
import { type ReactNode, useLayoutEffect, useMemo } from "react";
import {
  type ToolTabKind,
  type SessionPanelsModel,
  sessionPanelOwnerKey,
  useSessionPanels,
} from "@/features/session-panels";
import type { TerminalSessionsModel, TerminalTab } from "@/features/terminals";
import { QueryProvider } from "@/lib/query-provider";
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

export type TerminalTestDependencies = NonNullable<Parameters<typeof useAgentStudioTerminals>[1]>;

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
  let latest: TaskTerminalPanels | null = null;
  let props: HarnessProps = {
    workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
    taskId: "task-a",
    taskVersion: null,
    mountedTaskIds: [initial.taskId ?? "task-a"],
    ...initial,
  };
  function Harness({ workspaceId, taskId, taskVersion, mountedTaskIds, children }: HarnessProps) {
    const terminals = useAgentStudioTerminals(
      { workspaceId, repoPath: "/repo", taskId, taskVersion, mountedTaskIds },
      dependencies,
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
    latest = { terminals, panels };
    // The page ends each panel slide when its transition ends. No transition runs in tests.
    const { right, bottom } = panels;
    useLayoutEffect(() => {
      for (const panel of [right, bottom]) {
        if (panel.presence === "opening" || panel.presence === "closing") panel.onSettled();
      }
    }, [bottom, right]);
    return children ? <>{children(latest)}</> : null;
  }
  const element = () => (
    <QueryProvider useIsolatedClient>
      <Harness {...props} />
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
      props = { ...props, ...next };
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
