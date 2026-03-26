import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { KanbanColumn } from "./kanban-column";

const noop = (): void => {};

describe("KanbanColumn", () => {
  test("renders waiting-input tasks before active and idle tasks", () => {
    const waitingTask = createTaskCardFixture({ id: "TASK-WAITING", title: "Need answer" });
    const activeTask = createTaskCardFixture({ id: "TASK-ACTIVE", title: "Still running" });
    const idleTask = createTaskCardFixture({ id: "TASK-IDLE", title: "Queued" });
    const taskSessionsByTaskId = new Map<string, KanbanTaskSession[]>([
      [
        "TASK-WAITING",
        [
          {
            runtimeKind: "opencode",
            sessionId: "session-waiting",
            role: "build",
            scenario: "build_implementation_start",
            status: "running",
            presentationState: "waiting_input",
          },
        ],
      ],
      [
        "TASK-ACTIVE",
        [
          {
            runtimeKind: "opencode",
            sessionId: "session-active",
            role: "build",
            scenario: "build_implementation_start",
            status: "running",
            presentationState: "active",
          },
        ],
      ],
    ]);
    const taskActivityStateByTaskId = new Map<string, KanbanTaskActivityState>([
      ["TASK-WAITING", "waiting_input"],
      ["TASK-ACTIVE", "active"],
      ["TASK-IDLE", "idle"],
    ]);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanColumn, {
          column: {
            id: "in_progress",
            title: "In Progress",
            tasks: [waitingTask, activeTask, idleTask],
          },
          runStateByTaskId: new Map(),
          taskSessionsByTaskId,
          taskActivityStateByTaskId,
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    const waitingIndex = html.indexOf("Need answer");
    const activeIndex = html.indexOf("Still running");
    const idleIndex = html.indexOf("Queued");

    expect(waitingIndex).toBeGreaterThan(-1);
    expect(activeIndex).toBeGreaterThan(waitingIndex);
    expect(idleIndex).toBeGreaterThan(activeIndex);
    expect(html).toContain("kanban-waiting-input-card");
    expect(html).toContain("Waiting input");
    expect(html).toContain("Running");
  });
});
