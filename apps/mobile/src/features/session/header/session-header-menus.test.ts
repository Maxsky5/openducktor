import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  AgentStudioQuickActionOption,
  AgentStudioSessionQuickActionOption,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
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
      "TASK-1",
      [
        record("b-old", "build", "2026-10-02T09:00:00.000Z"),
        record("s-1", "spec", "2026-10-01T12:00:00.000Z"),
        record("b-new", "build", "2026-10-02T11:00:00.000Z"),
      ],
      [],
    );
    const current = groups[1]?.rows[1]?.key ?? "";
    const items = sessionHistoryItems(groups, current, NOW);
    expect(items.map((item) => [item.title, item.role, item.checked])).toEqual([
      ["Spec #1", "spec", false],
      ["Builder #2", "build", false],
      ["Builder #1", "build", true],
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
    const items = quickActionItems([
      option("Start Builder", "build_implementation_start"),
      option(
        "Generate Pull Request",
        "build_pull_request_generation",
        "Requires an existing Builder session.",
      ),
    ]);
    expect(items).toEqual([
      {
        id: "Start Builder",
        title: "Start Builder",
        role: "build",
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
    const items = quickActionItems([
      {
        kind: "task_action",
        id: "task:human_approve",
        taskAction: "human_approve",
        placement: "trailing",
        label: "Approve Task",
        description: "",
        disabled: false,
      },
    ]);
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
});
