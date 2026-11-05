import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  AgentStudioQuickActionOption,
  AgentStudioSessionQuickActionOption,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { CLOSE_TASK_ACTION } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { groupTaskSessions } from "@/features/tasks/details/task-sessions-model";
import { quickActionItems, sessionHistoryItems } from "./session-header-menus";

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

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

describe("sessionHistoryItems", () => {
  test("names each session as the desktop selector, newest first, and checks the open one", () => {
    const groups = groupTaskSessions(
      createTaskCardFixture({ id: "TASK-1" }),
      [
        record("b-old", "build", "2026-10-02T09:00:00.000Z"),
        record("s-1", "spec", "2026-10-01T12:00:00.000Z"),
        record("b-new", "build", "2026-10-02T11:00:00.000Z"),
      ],
      [],
      "ws-1",
    );
    const current = groups[1]?.rows[1]?.key ?? "";
    const items = sessionHistoryItems(groups, current, NOW);
    expect(items.map((item) => [item.title, item.role, item.checked])).toEqual([
      ["Spec #1", "specification", false],
      ["Builder #2", "building", false],
      ["Builder #1", "building", true],
    ]);
    expect(items[1]?.detail).toBe("1h ago · Saved");
  });
});

describe("quickActionItems", () => {
  test("keeps the order, shows the pull request icon, and tells why an action waits", () => {
    const option = (
      id: string,
      launchActionId: AgentStudioSessionQuickActionOption["launchActionId"],
      disabledReason?: string,
    ): AgentStudioQuickActionOption => {
      const built: AgentStudioSessionQuickActionOption = {
        kind: "session_start",
        id,
        role: "build",
        launchActionId,
        label: id,
        description: "",
        postStartAction: "kickoff",
        disabled: disabledReason !== undefined,
      };
      if (disabledReason) built.disabledReason = disabledReason;
      return built;
    };
    const items = quickActionItems(
      [
        option("Start Builder", "build_implementation_start"),
        option(
          "Generate Pull Request",
          "build_pull_request_generation",
          "Requires an existing Builder session.",
        ),
      ],
      createTaskCardFixture(),
    );
    expect(items).toEqual([
      {
        id: "Start Builder",
        title: "Start Builder",
        role: "building",
        disabled: false,
        detail: undefined,
        command: true,
      },
      {
        id: "Generate Pull Request",
        title: "Generate Pull Request",
        icon: "git-pull-request",
        disabled: true,
        detail: "Requires an existing Builder session.",
        command: true,
      },
    ]);
  });

  test("shows the workflow icon of a task action", () => {
    const items = quickActionItems(
      [
        {
          kind: "task_action",
          id: "task:human_approve",
          taskAction: { kind: "workflow", action: "human_approve" },
          placement: "trailing",
          label: "Approve Task",
          description: "",
          disabled: false,
        },
      ],
      createTaskCardFixture(),
    );
    expect(items).toEqual([
      {
        id: "task:human_approve",
        title: "Approve Task",
        icon: "circle-check-big",
        disabled: false,
        detail: undefined,
        command: true,
      },
    ]);
  });

  test("shows the core Close Task of a merged branch with its target", () => {
    const items = quickActionItems(
      [
        {
          kind: "task_action",
          id: "task:close_task",
          taskAction: { kind: "core", action: CLOSE_TASK_ACTION },
          placement: "leading",
          label: "Close Task",
          description: "The task branch is merged into origin/main.",
          mergedTarget: "origin/main",
          disabled: false,
        },
      ],
      createTaskCardFixture({ status: "human_review" }),
    );
    expect(items).toEqual([
      {
        id: "task:close_task",
        title: "Close Task",
        icon: "circle-check-big",
        disabled: false,
        detail: "Merged into origin/main",
        command: true,
      },
    ]);
  });
});
