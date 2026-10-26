import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  buildTaskToolSummary,
  resolveTaskToolTask,
  showsInvalidTaskToolAlert,
} from "./agent-chat-task-tool-model";

const meta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "odt_create_task",
  toolType: "generic",
  status: "completed",
  ...overrides,
});

describe("task tool model", () => {
  test("shows the requested title while a create call runs", () => {
    expect(
      buildTaskToolSummary(
        "create_task",
        meta({ status: "running", input: { title: "Fix login" } }),
        null,
      ),
    ).toBe("Fix login");
    expect(buildTaskToolSummary("update_task", meta({ status: "running" }), null)).toBe(
      "Updating task",
    );
  });

  test("alerts on a completed create call without a valid task", () => {
    const completed = meta({ output: "not json" });
    expect(resolveTaskToolTask("create_task", completed)).toBeNull();
    expect(showsInvalidTaskToolAlert("create_task", completed, null)).toBe(true);
    expect(buildTaskToolSummary("create_task", completed, null)).toBe("Invalid task result");
  });

  test("summarizes search filters", () => {
    expect(
      buildTaskToolSummary(
        "search_tasks",
        meta({ status: "running", input: { title: "login", limit: 5 } }),
        null,
      ),
    ).toBe("title: login · limit: 5");
  });
});
