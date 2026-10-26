import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
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
): AgentSessionSummary => ({
  externalSessionId: id,
  runtimeKind: "opencode",
  workingDirectory: "/wt/task-1",
  title: `${role} session`,
  startedAt: "2026-10-02T10:00:00.000Z",
  taskId,
  role,
  activityState,
  pendingApprovalCount: 0,
  pendingQuestionCount: 0,
  selectedModel: null,
});

describe("groupTaskSessions", () => {
  test("groups sessions by Workflow Role in workflow order, newest first", () => {
    const groups = groupTaskSessions(
      "TASK-1",
      [
        record("b-old", "build", "2026-10-01T08:00:00.000Z"),
        record("s-1", "spec", "2026-09-30T08:00:00.000Z"),
        record("b-new", "build", "2026-10-01T12:00:00.000Z"),
      ],
      [],
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
      "TASK-1",
      [record("b-a", "build", startedAt), record("b-b", "build", startedAt)],
      [],
    );
    expect(groups[0]?.rows.map((row) => [row.identity.externalSessionId, row.label])).toEqual([
      ["b-b", "Builder #2"],
      ["b-a", "Builder #1"],
    ]);
  });

  test("shows the live status and adds live sessions that the history does not list yet", () => {
    const groups = groupTaskSessions(
      "TASK-1",
      [record("b-1", "build", "2026-10-01T08:00:00.000Z")],
      [
        summary("b-1", "build", "waiting_input"),
        summary("q-1", "qa", "running"),
        summary("other", "qa", "running", "TASK-2"),
      ],
    );
    expect(groups.map((group) => group.role)).toEqual(["build", "qa"]);
    expect(groups[0]?.rows[0]).toMatchObject({
      statusLabel: "Waiting input",
      statusTone: "warning",
    });
    expect(groups[1]?.rows.map((row) => row.identity.externalSessionId)).toEqual(["q-1"]);
    expect(groups[1]?.rows[0]).toMatchObject({ statusLabel: "Running", live: true });
  });
});
