import { afterEach, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  TaskCard,
} from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { SessionNavigationList } from "@/components/layout/sidebar/session-navigation-list";
import { SessionNavigationRail } from "@/components/layout/sidebar/session-navigation-rail";
import { SessionMenuProvider } from "@/components/layout/sidebar/session-menu-provider";
import {
  alphaWorkspace,
  betaWorkspace,
  NOW,
  taskSessionEntry,
  workspaceSessionEntry,
} from "@/components/layout/sidebar/session-navigation.test-support";
import { createWorkspaceActivityObserver } from "@/features/workspace-activity/workspace-activity-observer";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import {
  buildSessionNavigationModel,
  type SessionNavigationEntry,
} from "@/state/read-models/session-navigation-read-model";
import {
  WorkspaceActivityContext,
  useWorkspaceSessionLiveSnapshot,
} from "@/state/workspace-activity/workspace-activity-context";
import { SessionReadStateProvider, useWatchSessionBlockers } from "./session-read-state";
import {
  sessionNavigationTargetKey,
  type SessionNavigationTarget,
} from "./session-navigation-target";
import {
  usePublishVisibleSessionTarget,
  VisibleSessionTargetProvider,
} from "./visible-session-target";

const observers: ReturnType<typeof createWorkspaceActivityObserver>[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.dispose());
  clients.splice(0).forEach((client) => client.clear());
});

const createHarness = ({ taskSession = false, unbound = false, noSessions = false } = {}) => {
  const listeners = new Map<string, (envelope: AgentSessionLiveEnvelope) => void>();
  const workspaces = [alphaWorkspace, betaWorkspace];
  const entries = workspaces.map((workspace) =>
    taskSession && workspace.workspaceId === "alpha"
      ? taskSessionEntry("native-alpha")
      : workspaceSessionEntry(`saved-${workspace.workspaceId}`, { workspace }),
  );
  if (noSessions) {
    for (const entry of entries) {
      if (entry.context.kind !== "task") continue;
      entry.context.sessions = [];
      entry.target = {
        kind: "task",
        workspaceId: entry.workspace.workspaceId,
        taskId: entry.context.task.id,
        role: null,
      };
      entry.key = sessionNavigationTargetKey(entry.target);
    }
  }
  const snapshots = entries.flatMap((entry): AgentSessionLiveSnapshot[] => {
    let identity;
    if (entry.target.kind === "task_session") identity = entry.target.identity;
    else if (entry.context.kind === "workspace") {
      const record = entry.context.session;
      // Saved workspace IDs and native IDs differ in production.
      record.externalSessionId =
        unbound && entry.workspace.workspaceId === "alpha"
          ? null
          : `native-${entry.workspace.workspaceId}`;
      identity = workspaceSessionIdentity(record);
    }
    if (!identity) return [];
    return [
      {
        ref: { repoPath: entry.workspace.repoPath, ...identity },
        activity: "idle",
        title: entry.title,
        startedAt: new Date(NOW - 3600000).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    ];
  });
  const observer = createWorkspaceActivityObserver({
    observe: async ({ repoPath }, listener) => {
      listeners.set(repoPath, listener);
      return () => listeners.delete(repoPath);
    },
    archivedSessions: {
      load: async () => {},
      read: () => ({ status: "ready", keys: new Set() }),
      subscribe: () => () => {},
    },
  });
  observers.push(observer);
  observer.syncWorkspaces(workspaces);
  const emit = (envelope: AgentSessionLiveEnvelope, repoPath = alphaWorkspace.repoPath) => {
    const listener = listeners.get(repoPath);
    if (!listener) throw new Error("Live observer is missing.");
    listener(envelope);
  };
  snapshots.forEach((session) =>
    emit(
      { type: "snapshot", repoPath: session.ref.repoPath, sessions: [session] },
      session.ref.repoPath,
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  type ViewProps = {
    rail?: boolean;
    scope?: string;
    allowNavigation?: boolean;
    taskStatus?: TaskCard["status"];
    taskReadError?: string | null;
  };
  function Body({
    rail = false,
    scope = "all",
    allowNavigation = true,
    taskStatus,
    taskReadError = null,
  }: ViewProps) {
    const live = useWorkspaceSessionLiveSnapshot();
    const [target, setTarget] = useState<SessionNavigationTarget | null>(null);
    const visibleRecord = entries.find(
      (entry) => entry.key === (target ? sessionNavigationTargetKey(target) : null),
    );
    const visibleTarget = useMemo<SessionNavigationTarget | null>(
      () => (target?.kind === "task" ? { ...target, role: "build" } : target),
      [target],
    );
    usePublishVisibleSessionTarget(
      visibleTarget,
      visibleRecord?.context.kind === "workspace"
        ? workspaceSessionIdentity(visibleRecord.context.session)
        : null,
    );
    const model = useMemo(
      () =>
        buildSessionNavigationModel(
          workspaces
            .filter((workspace) => scope === "all" || scope === workspace.workspaceId)
            .map((workspace) => ({
              workspace,
              tasks: {
                status: "ready",
                data: entries.flatMap((entry) =>
                  entry.workspace.workspaceId === workspace.workspaceId &&
                  entry.context.kind === "task"
                    ? [{ ...entry.context.task, status: taskStatus ?? entry.context.task.status }]
                    : [],
                ),
                refreshError: taskReadError,
              },
              taskSessions: new Map(
                entries.flatMap((entry) =>
                  entry.workspace.workspaceId === workspace.workspaceId &&
                  entry.context.kind === "task"
                    ? [
                        [
                          entry.context.task.id,
                          {
                            status: "ready" as const,
                            data: [...entry.context.sessions],
                            refreshError: null,
                          },
                        ],
                      ]
                    : [],
                ),
              ),
              workspaceSessions: {
                status: "ready",
                data: entries.flatMap((entry) =>
                  entry.workspace.workspaceId === workspace.workspaceId &&
                  entry.context.kind === "workspace"
                    ? [entry.context.session]
                    : [],
                ),
                refreshError: null,
              },
              live: live.statesByWorkspaceId.get(workspace.workspaceId) ?? { kind: "unknown" },
            })),
        ),
      [live, scope, taskReadError, taskStatus],
    );
    useWatchSessionBlockers(model);
    const Navigation = rail ? SessionNavigationRail : SessionNavigationList;
    return (
      <Navigation
        model={model}
        selection={{
          entryKey: target ? sessionNavigationTargetKey(target) : null,
          visibleKey: target ? sessionNavigationTargetKey(target) : null,
        }}
        now={NOW}
        onOpen={(entry: SessionNavigationEntry) => {
          if (allowNavigation) setTarget(entry.target);
        }}
        onRetry={() => {}}
      />
    );
  }
  function View(props: ViewProps) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceActivityContext value={observer}>
          <VisibleSessionTargetProvider>
            <SessionReadStateProvider>
              <SessionMenuProvider>
                <Body {...props} />
              </SessionMenuProvider>
            </SessionReadStateProvider>
          </VisibleSessionTargetProvider>
        </WorkspaceActivityContext>
      </QueryClientProvider>
    );
  }
  return { View, emit, session: snapshots[0]! };
};

test("reads a task conversation by the full identity published with its visible role", () => {
  const { View, emit, session } = createHarness({ taskSession: true });
  render(<View />);
  const row = () => screen.getByRole("button", { name: /Task native-alpha/ });
  act(() => {
    emit({ type: "session_upsert", session: { ...session, activity: "running" } });
    emit({ type: "session_upsert", session });
  });
  expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
  fireEvent.click(row());
  expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
});

test("clears a manual unread mark when an unbound workspace session becomes visible", async () => {
  const { View } = createHarness({ unbound: true });
  render(<View />);
  const row = () => screen.getByRole("button", { name: /Chat saved-alpha/ });
  fireEvent.contextMenu(row(), { button: 2, clientX: 20, clientY: 20 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as unread" }));
  expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();

  fireEvent.click(row());
  expect(row().getAttribute("aria-current")).toBe("true");
  expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
});

test.each(["in_progress", "blocked"] as const)(
  "tracks repeated blockers with no saved sessions after first loading %s",
  async (initialStatus) => {
    const { View } = createHarness({ taskSession: true, noSessions: true });
    const view = render(<View taskStatus={initialStatus} allowNavigation={false} />);
    const row = () => screen.getByRole("button", { name: /Task native-alpha/ });
    const markRead = async () => {
      fireEvent.contextMenu(row(), { button: 2, clientX: 20, clientY: 20 });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as read" }));
      expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
    };
    if (initialStatus === "blocked") {
      expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
    }
    view.rerender(<View taskStatus="in_progress" allowNavigation={false} />);
    expect(screen.queryByRole("button", { name: /Task native-alpha/ })).toBeNull();

    view.rerender(<View taskStatus="blocked" taskReadError="Offline" allowNavigation={false} />);
    expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
    view.rerender(<View taskStatus="blocked" allowNavigation={false} />);
    expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
    await markRead();

    view.rerender(<View taskStatus="in_progress" allowNavigation={false} />);
    expect(screen.queryByRole("button", { name: /Task native-alpha/ })).toBeNull();
    view.rerender(<View taskStatus="blocked" allowNavigation={false} />);
    expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
    await markRead();

    view.rerender(<View taskStatus="closed" allowNavigation={false} />);
    expect(screen.queryByRole("button", { name: /Task native-alpha/ })).toBeNull();
    view.rerender(<View taskStatus="blocked" allowNavigation={false} />);
    expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();

    view.rerender(<View taskStatus="in_progress" />);
    view.rerender(<View taskStatus="blocked" />);
    expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
    fireEvent.click(row());
    expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
  },
);

test("captures fast background completions across sidebar scopes and layouts, and reads only committed content", async () => {
  const { View, emit, session } = createHarness();
  const view = render(<View allowNavigation={false} />);
  const row = () => screen.getByRole("button", { name: /Chat saved-alpha/ });
  expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
  // These changes share one React commit. The stream subscription must retain both.
  act(() => {
    emit({ type: "session_upsert", session: { ...session, activity: "running" } });
    emit({ type: "session_upsert", session });
  });
  expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
  view.rerender(<View scope="beta" allowNavigation={false} />);
  expect(screen.queryByRole("button", { name: /Chat saved-alpha/ })).toBeNull();
  act(() => {
    emit({ type: "session_upsert", session: { ...session, activity: "running" } });
    emit({
      type: "session_upsert",
      session: { ...session, pendingQuestions: [{ requestId: "q", questions: [] }] },
    });
  });
  view.rerender(<View rail allowNavigation={false} />);
  expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
  expect(within(row()).queryByRole("img", { name: "Session running" })).toBeNull();
  fireEvent.click(row());
  expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
  act(() => emit({ type: "session_upsert", session }));
  fireEvent.focus(row());
  expect(await screen.findByRole("dialog", { name: "Chat saved-alpha" })).toBeTruthy();
  expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
  fireEvent.keyDown(row(), { key: "Escape" });
  view.rerender(<View allowNavigation />);
  fireEvent.click(row());
  expect(row().getAttribute("aria-current")).toBe("true");
  expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
  act(() => emit({ type: "session_upsert", session: { ...session, activity: "running" } }));
  expect(within(row()).getByRole("img", { name: "Session running" })).toBeTruthy();
  act(() => emit({ type: "session_upsert", session }));
  expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
});

test("keeps a completion unread while the selected session is in a hidden window, then reads it on return", () => {
  const { View, emit, session } = createHarness();
  render(<View />);
  const row = () => screen.getByRole("button", { name: /Chat saved-alpha/ });
  fireEvent.click(row());
  const descriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  try {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    act(() => {
      emit({ type: "session_upsert", session: { ...session, activity: "running" } });
      emit({ type: "session_upsert", session });
    });
    expect(within(row()).getByRole("img", { name: "Unread session" })).toBeTruthy();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    expect(within(row()).getByRole("img", { name: "Session read" })).toBeTruthy();
  } finally {
    if (descriptor) Object.defineProperty(document, "visibilityState", descriptor);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});
