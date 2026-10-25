import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  WorkspaceSessionLiveFacts,
  WorkspaceSessionLiveState,
} from "@openducktor/frontend-core/workspace-activity/workspace-activity-state";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionActivityState } from "@openducktor/frontend-core/types/agent-session-activity";
import { buildPaletteTaskView } from "./command-palette-task-model";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const record = (
  externalSessionId: string,
  role: AgentSessionRecord["role"],
  startedAt: string,
): AgentSessionRecord => ({
  externalSessionId,
  role,
  startedAt,
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
});

const liveState = (
  activity: ReadonlyArray<[AgentSessionRecord, AgentSessionActivityState]>,
): WorkspaceSessionLiveState => ({
  kind: "ready",
  faults: new Map(),
  sessions: new Map(
    activity.map(([session, activityState]): [string, WorkspaceSessionLiveFacts] => [
      agentSessionIdentityKey(session),
      {
        activityState,
        pendingQuestion: false,
        pendingPermission: false,
        pendingInputs: new Set(),
        fault: null,
        statusUnavailableReason: null,
      },
    ]),
  ),
});

const ready = (records: AgentSessionRecord[]) =>
  ({ status: "ready", data: records, refreshError: null }) as const;

const inProgressTask = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createTaskCardFixture({
    status: "in_progress",
    availableActions: [
      "build_start",
      "open_builder",
      "reset_implementation",
      "reset_task",
      "close_task",
    ],
    ...overrides,
  });

describe("command palette task model", () => {
  test("opens the running session that started last before any idle session", () => {
    const idleBuilder = record("build-new", "build", "2026-03-03T00:00:00.000Z");
    const runningSpec = record("spec-old", "spec", "2026-03-01T00:00:00.000Z");
    const runningQa = record("qa-mid", "qa", "2026-03-02T00:00:00.000Z");

    const view = buildPaletteTaskView({
      task: inProgressTask(),
      sessions: ready([idleBuilder, runningSpec, runningQa]),
      live: liveState([
        [runningSpec, "waiting_input"],
        [runningQa, "running"],
      ]),
    });

    expect(view.open).toMatchObject({ kind: "open_session", session: { role: "qa" } });
  });

  test("opens the latest saved session of any role when nothing runs", () => {
    const view = buildPaletteTaskView({
      task: inProgressTask(),
      sessions: ready([
        record("spec-1", "spec", "2026-03-01T00:00:00.000Z"),
        record("build-1", "build", "2026-03-04T00:00:00.000Z"),
      ]),
      live: liveState([]),
    });

    expect(view.open).toMatchObject({
      kind: "open_session",
      session: { role: "build", identity: { externalSessionId: "build-1" } },
    });
  });

  test("opens the task details when the task has no session", () => {
    const view = buildPaletteTaskView({
      task: createTaskCardFixture({ availableActions: ["build_start"] }),
      sessions: ready([]),
      live: liveState([]),
    });

    expect(view.open).toEqual({ kind: "details" });
    expect(view.nextStep).toBe("build_start");
  });

  test("waits for the saved sessions before it opens or runs anything", () => {
    const loading = buildPaletteTaskView({
      task: inProgressTask(),
      sessions: undefined,
      live: liveState([]),
    });
    const failed = buildPaletteTaskView({
      task: inProgressTask(),
      sessions: { status: "error", message: "Host offline" },
      live: liveState([]),
    });

    expect(loading.open).toBeNull();
    expect(loading.sessionsNote).toBe("Loading sessions…");
    expect(loading.nextStep).toBeNull();
    expect(failed.open).toBeNull();
    expect(failed.sessionsNote).toBe("Sessions could not load: Host offline");
    expect(failed.actions.map((action) => action.key)).toEqual([
      "edit",
      "details",
      "copy-id",
      "reset-task",
      "delete",
    ]);
  });

  test("opens the details of a closed task and offers no session or next step", () => {
    const view = buildPaletteTaskView({
      task: createTaskCardFixture({ status: "closed" }),
      sessions: ready([record("build-1", "build", "2026-03-04T00:00:00.000Z")]),
      live: liveState([]),
    });

    expect(view.open).toEqual({ kind: "details" });
    expect(view.nextStep).toBeNull();
    expect(view.actions.map((action) => action.key)).toEqual([
      "edit",
      "details",
      "copy-id",
      "delete",
    ]);
  });

  test("lists session actions, workflow steps, and task actions, destructive last, without Close Task", () => {
    const builder = record("build-1", "build", "2026-03-04T00:00:00.000Z");
    const view = buildPaletteTaskView({
      task: inProgressTask({
        availableActions: [
          "build_start",
          "open_builder",
          "qa_start",
          "reset_implementation",
          "reset_task",
          "close_task",
        ],
      }),
      sessions: ready([builder]),
      live: liveState([]),
    });

    expect(view.actions.map((action) => action.key)).toEqual([
      "latest",
      "session:build",
      "workflow:build_start",
      "workflow:qa_start",
      "edit",
      "details",
      "copy-id",
      "workflow:reset_implementation",
      "reset-task",
      "delete",
    ]);
    expect(view.actions.find((action) => action.key === "latest")?.detail).toBe("Builder");
    expect(view.actions.filter((action) => action.destructive).map((action) => action.key)).toEqual(
      ["workflow:reset_implementation", "reset-task", "delete"],
    );
  });
});
