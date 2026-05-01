import { beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";

let KanbanColumn: typeof import("./kanban-column").KanbanColumn;

const noop = (): void => {};

describe("KanbanColumn", () => {
  beforeAll(async () => {
    const modulePath = `./kanban-column?test=${Date.now()}`;
    const kanbanColumnModule = (await import(modulePath)) as {
      KanbanColumn: typeof import("./kanban-column").KanbanColumn;
    };
    KanbanColumn = kanbanColumnModule.KanbanColumn;
  });

  test("passes waiting-input ordering data through to rendered task cards", () => {
    const waitingTask = createTaskCardFixture({ id: "TASK-WAITING", title: "Need answer" });
    const activeTask = createTaskCardFixture({ id: "TASK-ACTIVE", title: "Still running" });
    const idleTask = createTaskCardFixture({ id: "TASK-IDLE", title: "Queued" });
    const taskSessionsByTaskId = new Map<string, KanbanTaskSession[]>([
      [
        "TASK-WAITING",
        [
          {
            runtimeKind: "opencode",
            externalSessionId: "session-waiting",
            role: "build",
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
            externalSessionId: "session-active",
            role: "build",
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
          taskSessionsByTaskId,
          taskActivityStateByTaskId,
          activeTaskSessionContextByTaskId: new Map(),
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
          onOpenSession: noop,
        }),
      ),
    );

    expect(html.indexOf("Need answer")).toBeLessThan(html.indexOf("Still running"));
    expect(html.indexOf("Still running")).toBeLessThan(html.indexOf("Queued"));
  });
});
