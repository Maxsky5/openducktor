import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { act, type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { KanbanColumn } from "./kanban-column";

const renderColumnMarkup = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(createElement(TooltipProvider, null, element));

const noop = (): void => {};

describe("KanbanColumn", () => {
  test("remeasures mounted cards when session content and density change in a long lane", async () => {
    await withAnimationFrameTestDriver(async (frames) => {
      const tasks = Array.from({ length: 40 }, (_, index) =>
        createTaskCardFixture({
          id: `measurement-${index}`,
          status: "ready_for_dev",
          availableActions: ["build_start"],
        }),
      );
      const firstTask = tasks[0]!;
      const props: ComponentProps<typeof KanbanColumn> = {
        column: { id: "ready_for_dev", title: "Ready for Dev", tasks },
        taskSessionsByTaskId: new Map(),
        historicalSessionsByTaskId: new Map(),
        activeTaskSessionContextByTaskId: new Map(),
        taskActivityStateByTaskId: new Map(tasks.map((task) => [task.id, "idle"])),
        onOpenDetails: noop,
        onDelegate: noop,
        onPlan: noop,
        onOpenSession: noop,
      };
      const view = render(
        <MemoryRouter>
          <TooltipProvider>
            <KanbanColumn {...props} />
          </TooltipProvider>
        </MemoryRouter>,
      );
      try {
        const wrapper = view.container.querySelector(
          `article[data-kanban-task-id="${firstTask.id}"]`,
        )!.parentElement!;
        let measuredHeight = 200;
        Object.defineProperty(wrapper, "getBoundingClientRect", {
          configurable: true,
          value: () => new DOMRect(0, 0, 302, measuredHeight),
        });
        const totalHeight = () =>
          Number.parseFloat(
            view.container.querySelector<HTMLElement>("div[style*='min-height']")!.style.minHeight,
          );
        const normalEstimate = 40 * 180 + 39 * 12;
        await frames.flushFrame();
        expect(totalHeight()).toBe(normalEstimate + 20);
        measuredHeight = 240;
        const historicalSessionsByTaskId: ComponentProps<
          typeof KanbanColumn
        >["historicalSessionsByTaskId"] = new Map([
          [
            firstTask.id,
            [
              {
                externalSessionId: "planner",
                runtimeKind: "codex",
                workingDirectory: "/repo",
                role: "planner",
                startedAt: "2026-10-01T10:00:00Z",
                selectedModel: null,
              },
            ],
          ],
        ]);
        await act(async () =>
          view.rerender(
            <MemoryRouter>
              <TooltipProvider>
                <KanbanColumn {...props} historicalSessionsByTaskId={historicalSessionsByTaskId} />
              </TooltipProvider>
            </MemoryRouter>,
          ),
        );
        await frames.flushFrame();
        expect(totalHeight()).toBe(normalEstimate + 60);
        measuredHeight = 120;
        await act(async () =>
          view.rerender(
            <MemoryRouter>
              <TooltipProvider>
                <KanbanColumn
                  {...props}
                  taskCardView="compact"
                  historicalSessionsByTaskId={historicalSessionsByTaskId}
                />
              </TooltipProvider>
            </MemoryRouter>,
          ),
        );
        await frames.flushFrame();
        expect(totalHeight()).toBe(40 * 116 + 39 * 12 + 4);
      } finally {
        view.unmount();
      }
    });
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
            workingDirectory: "/repo/worktrees/waiting",
            externalSessionId: "session-waiting",
            role: "build",
            activityState: "waiting_input",
          },
        ],
      ],
      [
        "TASK-ACTIVE",
        [
          {
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/active",
            externalSessionId: "session-active",
            role: "build",
            activityState: "running",
          },
        ],
      ],
    ]);
    const taskActivityStateByTaskId = new Map<string, KanbanTaskActivityState>([
      ["TASK-WAITING", "waiting_input"],
      ["TASK-ACTIVE", "active"],
      ["TASK-IDLE", "idle"],
    ]);

    const html = renderColumnMarkup(
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
          historicalSessionsByTaskId: new Map(),
          taskActivityStateByTaskId,
          activeTaskSessionContextByTaskId: new Map(),
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onOpenSession: noop,
        }),
      ),
    );

    expect(html.indexOf("Need answer")).toBeLessThan(html.indexOf("Still running"));
    expect(html.indexOf("Still running")).toBeLessThan(html.indexOf("Queued"));
  });
});
