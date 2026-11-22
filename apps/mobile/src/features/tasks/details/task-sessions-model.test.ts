import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { observeAgentSessionSummaries } from "@openducktor/frontend-core/sessions/agent-session-snapshots";
import { groupTaskSessions } from "./task-sessions-model";

const record = (
  id: string,
  role: AgentSessionRecord["role"],
  startedAt: string,
): AgentSessionRecord => ({
  externalSessionId: id,
  role,
  startedAt,
  runtimeKind: "opencode",
  workingDirectory: "/wt/task-1",
  selectedModel: null,
});

const summary = (
  id: string,
  role: AgentSessionSummary["role"],
  activityState: AgentSessionSummary["activityState"],
  taskId = "TASK-1",
  waitingOnBackground = false,
): AgentSessionSummary => ({
  workspaceId: "ws-1",
  externalSessionId: id,
  runtimeKind: "opencode",
  workingDirectory: "/wt/task-1",
  title: `${role} session`,
  startedAt: "2026-10-02T10:00:00.000Z",
  taskId,
  role,
  activityState,
  waitingOnBackground,
  pendingApprovalCount: 0,
  pendingQuestionCount: 0,
  selectedModel: null,
  livePresence: "present",
});

describe("groupTaskSessions", () => {
  test("groups sessions by Workflow Role in workflow order, newest first", () => {
    const groups = groupTaskSessions(
      createTaskCardFixture({ id: "TASK-1" }),
      [
        record("b-old", "build", "2026-10-01T08:00:00.000Z"),
        record("s-1", "spec", "2026-09-30T08:00:00.000Z"),
        record("b-new", "build", "2026-10-01T12:00:00.000Z"),
      ],
      [],
      "ws-1",
    );
    expect(groups.map((group) => group.roleLabel)).toEqual(["Spec", "Builder"]);
    expect(groups[1]?.rows.map((row) => row.identity.externalSessionId)).toEqual([
      "b-new",
      "b-old",
    ]);
    expect(groups[1]?.rows[0]).toMatchObject({
      label: "Builder #2",
      statusLabel: "Saved",
      runtimeLabel: "OpenCode",
      live: false,
    });
  });

  test("orders sessions that started together by identity, as the desktop selector", () => {
    const startedAt = "2026-10-01T08:00:00.000Z";
    const groups = groupTaskSessions(
      createTaskCardFixture({ id: "TASK-1" }),
      [record("b-a", "build", startedAt), record("b-b", "build", startedAt)],
      [],
      "ws-1",
    );
    expect(groups[0]?.rows.map((row) => [row.identity.externalSessionId, row.label])).toEqual([
      ["b-b", "Builder #2"],
      ["b-a", "Builder #1"],
    ]);
  });

  test("shows the live status and adds live sessions that the history does not list yet", () => {
    const groups = groupTaskSessions(
      createTaskCardFixture({ id: "TASK-1" }),
      [record("b-1", "build", "2026-10-01T08:00:00.000Z")],
      [
        summary("b-1", "build", "waiting_input"),
        summary("q-1", "qa", "running"),
        summary("other", "qa", "running", "TASK-2"),
        { ...summary("foreign", "qa", "running"), workspaceId: "ws-2" },
      ],
      "ws-1",
    );
    expect(groups.map((group) => group.role)).toEqual(["build", "qa"]);
    expect(groups[0]?.rows[0]).toMatchObject({
      statusLabel: "Waiting input",
      statusTone: "warning",
    });
    expect(groups[1]?.rows.map((row) => row.identity.externalSessionId)).toEqual(["q-1"]);
    expect(groups[1]?.rows[0]).toMatchObject({ statusLabel: "Running", live: true });
  });

  test("shows a running session that waits on background tasks as a still Running status", () => {
    const groups = groupTaskSessions(
      createTaskCardFixture({ id: "TASK-1" }),
      [],
      [summary("b-1", "build", "running", "TASK-1", true)],
      "ws-1",
    );
    expect(groups[0]?.rows[0]).toMatchObject({
      statusLabel: "Running",
      statusDescription: "Running and waiting on background tasks",
      statusReason: null,
      statusTone: "pending",
      statusIcon: "hourglass",
      live: true,
    });
  });

  test("shows plain Running without the Background style while the live stream is down", () => {
    const live = observeAgentSessionSummaries(
      {
        kind: "failed",
        workspaceRepoPath: "/repo",
        message: "Live stream ended",
        source: "live-stream",
      },
      [summary("b-1", "build", "running", "TASK-1", true)],
    );
    const groups = groupTaskSessions(createTaskCardFixture({ id: "TASK-1" }), [], live, "ws-1");
    expect(groups[0]?.rows[0]).toMatchObject({
      statusLabel: "Running",
      statusTone: "running",
      statusIcon: null,
      activityState: "running",
    });
  });

  test("shows an unavailable status, not Running, when a session loses its tracking", () => {
    const groups = groupTaskSessions(
      createTaskCardFixture({ id: "TASK-1" }),
      [record("b-1", "build", "2026-10-01T08:00:00.000Z")],
      [
        {
          ...summary("b-1", "build", "running"),
          statusUnavailableReason: "Background task tracking was lost.",
        },
      ],
      "ws-1",
    );
    expect(groups[0]?.rows[0]).toMatchObject({
      statusLabel: "Status unavailable",
      statusDescription: "Status unavailable: Background task tracking was lost.",
      statusReason: "Background task tracking was lost.",
      live: false,
      activityState: null,
    });
  });
});
