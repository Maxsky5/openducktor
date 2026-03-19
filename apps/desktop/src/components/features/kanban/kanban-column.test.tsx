import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  KanbanActiveSession,
  KanbanTaskActivityState,
} from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import type { KanbanTaskCard } from "./kanban-task-card";

const renderedCards: Array<{ taskId: string; taskActivityState: string | undefined }> = [];

mock.module("@/components/features/kanban/kanban-task-card", () => ({
  KanbanTaskCard: ({
    task,
    taskActivityState,
  }: ComponentProps<typeof KanbanTaskCard>): ReactElement => {
    renderedCards.push({ taskId: task.id, taskActivityState });
    return <div data-task-id={task.id} data-activity-state={taskActivityState} />;
  },
}));

mock.module("@/components/features/kanban/use-kanban-virtualization", () => ({
  useKanbanVirtualization: ({ tasks }: { tasks: Array<{ id: string }> }) => ({
    containerRef: () => {},
    renderModel: {
      kind: "simple" as const,
      visibleTasks: tasks,
    },
    measurementVersion: 0,
    onMeasuredHeight: () => {},
  }),
}));

const noop = (): void => {};

describe("KanbanColumn", () => {
  test("passes waiting-input ordering data through to rendered task cards", async () => {
    renderedCards.length = 0;
    const { KanbanColumn } = await import("./kanban-column");
    const waitingTask = createTaskCardFixture({ id: "TASK-WAITING", title: "Need answer" });
    const activeTask = createTaskCardFixture({ id: "TASK-ACTIVE", title: "Still running" });
    const idleTask = createTaskCardFixture({ id: "TASK-IDLE", title: "Queued" });
    const activeSessionsByTaskId = new Map<string, KanbanActiveSession[]>([
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
      createElement(KanbanColumn, {
        column: {
          id: "in_progress",
          title: "In Progress",
          tasks: [waitingTask, activeTask, idleTask],
        },
        runStateByTaskId: new Map(),
        activeSessionsByTaskId,
        taskActivityStateByTaskId,
        onOpenDetails: noop,
        onDelegate: noop,
        onPlan: noop,
        onBuild: noop,
      }),
    );

    expect(renderedCards).toEqual([
      { taskId: "TASK-WAITING", taskActivityState: "waiting_input" },
      { taskId: "TASK-ACTIVE", taskActivityState: "active" },
      { taskId: "TASK-IDLE", taskActivityState: "idle" },
    ]);
    expect(html).toContain('data-task-id="TASK-WAITING"');
    expect(html).toContain('data-activity-state="waiting_input"');
  });
});
