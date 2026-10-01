import { describe, expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KanbanTaskActivityState } from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { KanbanPageContent } from "./kanban-page-content";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const visibleTask = createTaskCardFixture({
  id: "TASK-1",
  title: "Visible task",
  status: "in_progress",
});
const visibleTaskActivityState = new Map<string, KanbanTaskActivityState>([["TASK-1", "idle"]]);

const model: KanbanPageContentModel = {
  isLoadingTasks: false,
  isSwitchingWorkspace: false,
  emptyColumnDisplay: "show",
  taskCardView: "normal",
  showHorizontalScrollbars: false,
  columns: [
    {
      id: "open",
      title: "Backlog",
      tasks: [],
    },
  ],
  taskSessionsByTaskId: new Map(),
  historicalSessionsByTaskId: new Map(),
  activeTaskSessionContextByTaskId: new Map(),
  taskActivityStateByTaskId: new Map(),
  onOpenDetails: () => {},
  onDelegate: () => {},
  onOpenSession: () => {},
  onPlan: () => {},
  onQaStart: () => {},
  onHumanApprove: () => {},
  onHumanRequestChanges: () => {},
  onResetImplementation: () => {},
};

describe("KanbanPageContent", () => {
  for (const taskCardView of ["normal", "compact"] as const) {
    for (const name of ["Copy task ID", "PR #110", "GitHub #42"]) {
      test(`keeps ${name} focused when a ${taskCardView} card moves lanes`, () => {
        const task = createTaskCardFixture({
          id: "moving-task",
          status: "ready_for_dev",
          availableActions: ["build_start"],
          pullRequest: {
            providerId: "github",
            number: 110,
            url: "https://github.com/openai/openducktor/pull/110",
            state: "open",
            createdAt: "2026-03-12T12:24:09Z",
            updatedAt: "2026-03-12T12:24:09Z",
            lastSyncedAt: undefined,
            mergedAt: undefined,
            closedAt: undefined,
          },
          sourceIssue: {
            providerId: "github",
            scope: "openai/openducktor",
            sourceId: "42",
            number: "42",
            url: "https://github.com/openai/openducktor/issues/42",
          },
        });
        const movingModel: KanbanPageContentModel = {
          ...model,
          taskCardView,
          columns: [
            { id: "ready_for_dev", title: "Ready for Dev", tasks: [task] },
            { id: "in_progress", title: "In progress", tasks: [] },
          ],
          taskActivityStateByTaskId: new Map([[task.id, "idle"]]),
        };
        const view = render(<KanbanPageContent model={movingModel} />);
        try {
          view.getByRole("button", { name }).focus();
          view.rerender(
            <KanbanPageContent
              model={{
                ...movingModel,
                columns: [
                  { ...movingModel.columns[0]!, tasks: [] },
                  { ...movingModel.columns[1]!, tasks: [{ ...task, status: "in_progress" }] },
                ],
              }}
            />,
          );
          expect(document.activeElement).toBe(view.getByRole("button", { name }));
        } finally {
          view.unmount();
        }
      });
    }
  }

  test("repairs focus when scrolling unmounts a focused virtual card without a board render", async () => {
    await withAnimationFrameTestDriver(async (frames) => {
      const tasks = Array.from({ length: 40 }, (_, index) =>
        createTaskCardFixture({
          id: `scroll-${index}`,
          availableActions: index === 0 ? ["build_start"] : [],
        }),
      );
      const view = render(
        <KanbanPageContent
          model={{
            ...model,
            columns: [{ id: "open", title: "Backlog", tasks }],
            taskActivityStateByTaskId: new Map(tasks.map((task) => [task.id, "idle"])),
          }}
        />,
      );
      try {
        let laneTop = 0;
        const lane = view.getByRole("region", { name: "Backlog lane" });
        const viewport = lane.querySelector("div.flex-1")!;
        Object.defineProperty(viewport, "getBoundingClientRect", {
          configurable: true,
          value: () => new DOMRect(0, laneTop, 302, 8000),
        });
        await frames.flushFrame();
        view.getByRole("button", { name: "Start Builder" }).focus();
        laneTop = -7000;
        window.dispatchEvent(new Event("scroll"));
        await frames.flushFrame();
        expect(view.queryByRole("button", { name: "Start Builder" })).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(lane), { timeout: 500 });
      } finally {
        view.unmount();
      }
    });
  });
  test("transfers session focus with a task across lanes and leaves outside focus in place", () => {
    const task = createTaskCardFixture({
      id: "moving-task",
      status: "ready_for_dev",
      availableActions: ["build_start"],
    });
    const movingModel: KanbanPageContentModel = {
      ...model,
      columns: [
        { id: "ready_for_dev", title: "Ready for Dev", tasks: [task] },
        { id: "in_progress", title: "In progress", tasks: [] },
      ],
      historicalSessionsByTaskId: new Map([
        [
          task.id,
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
      ]),
      taskActivityStateByTaskId: new Map([[task.id, "idle"]]),
      onOpenSession: mock(() => {}),
    };
    const view = render(
      <>
        <input aria-label="Outside board" />
        <KanbanPageContent model={movingModel} />
      </>,
    );
    try {
      view.getByRole("button", { name: "Open Planner session" }).focus();
      const destinationModel: KanbanPageContentModel = {
        ...movingModel,
        columns: [
          { ...movingModel.columns[0]!, tasks: [] },
          { ...movingModel.columns[1]!, tasks: [{ ...task, status: "in_progress" }] },
        ],
      };
      view.rerender(
        <>
          <input aria-label="Outside board" />
          <KanbanPageContent model={destinationModel} />
        </>,
      );
      expect(document.activeElement).toBe(
        view.getByRole("button", { name: "Open Planner session" }),
      );
      const outside = view.getByRole("textbox", { name: "Outside board" });
      outside.focus();
      view.rerender(
        <>
          <input aria-label="Outside board" />
          <KanbanPageContent model={movingModel} />
        </>,
      );
      expect(document.activeElement).toBe(outside);
    } finally {
      view.unmount();
    }
  });

  test("transfers focus to the destination lane when the moved card is offscreen", () => {
    const task = createTaskCardFixture({ id: "moving-task", availableActions: ["build_start"] });
    const nextTasks = Array.from({ length: 40 }, (_, index) =>
      createTaskCardFixture({ id: `other-${index}`, availableActions: [] }),
    );
    const movingModel: KanbanPageContentModel = {
      ...model,
      columns: [
        { id: "open", title: "Backlog", tasks: [task] },
        { id: "in_progress", title: "In progress", tasks: nextTasks },
      ],
      taskActivityStateByTaskId: new Map([task, ...nextTasks].map((entry) => [entry.id, "idle"])),
    };
    const view = render(<KanbanPageContent model={movingModel} />);
    try {
      view.getByRole("button", { name: "Start Builder" }).focus();
      view.rerender(
        <KanbanPageContent
          model={{
            ...movingModel,
            columns: [
              { ...movingModel.columns[0]!, tasks: [] },
              {
                ...movingModel.columns[1]!,
                tasks: [...nextTasks, { ...task, status: "in_progress" }],
              },
            ],
          }}
        />,
      );
      expect(view.queryByRole("button", { name: "Start Builder" })).toBeNull();
      expect(document.activeElement).toBe(view.getByRole("region", { name: "In progress lane" }));
    } finally {
      view.unmount();
    }
  });
  test("keeps the horizontal scroll region stretched across the remaining page height", () => {
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html).toContain("flex-1");
    expect(html).toContain("w-full");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("overflow-y-visible");
    expect(html).toContain("min-h-full");
    expect(html).toContain("hide-scrollbar");
  });

  test("omits scrollbar hiding when horizontal scrollbars should be visible", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          showHorizontalScrollbars: true,
        },
      }),
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("hide-scrollbar");
  });

  test("omits scrollbar hiding while horizontal scrollbar visibility is unresolved", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          showHorizontalScrollbars: null,
        },
      }),
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("hide-scrollbar");
  });

  test("renders a blocking board loader while the initial task load is in progress", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          isLoadingTasks: true,
        },
      }),
    );

    expect(html).toContain('data-testid="kanban-loading-overlay"');
    expect(html.match(/data-testid="kanban-loading-lane"/g)?.length).toBe(8);
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain('data-testid="kanban-refresh-indicator"');
  });

  test("does not render a refresh indicator when tasks are already visible", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          isLoadingTasks: true,
          columns: [
            {
              id: "open",
              title: "Backlog",
              tasks: [visibleTask],
            },
          ],
          taskActivityStateByTaskId: visibleTaskActivityState,
        },
      }),
    );

    expect(html).not.toContain('data-testid="kanban-refresh-indicator"');
    expect(html).not.toContain("Refreshing tasks...");
    expect(html).not.toContain('data-testid="kanban-loading-overlay"');
  });

  test("shows empty columns when the display mode is show", () => {
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html).toContain("Backlog");
    expect(html).not.toContain("Backlog column is empty and collapsed");
  });

  test("hides empty columns when the display mode is hidden", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          emptyColumnDisplay: "hidden",
        },
      }),
    );

    expect(html).not.toContain("Backlog");
    expect(html).not.toContain("Backlog column is empty and collapsed");
  });

  test("collapses empty columns without collapsing populated columns", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          emptyColumnDisplay: "collapsed",
          columns: [
            ...model.columns,
            {
              id: "in_progress",
              title: "In progress",
              tasks: [visibleTask],
            },
          ],
          taskActivityStateByTaskId: visibleTaskActivityState,
        },
      }),
    );

    expect(html).toContain("Backlog column is empty and collapsed");
    expect(html).toContain("In progress");
    expect(html).toContain("Visible task");
  });

  test("passes compact task card view through to populated columns", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          taskCardView: "compact",
          columns: [
            {
              id: "in_progress",
              title: "In progress",
              tasks: [visibleTask],
            },
          ],
          taskActivityStateByTaskId: visibleTaskActivityState,
        },
      }),
    );

    expect(html).toContain('aria-label="Copy task ID"');
    expect(html).not.toContain(">TASK-1<");
    expect(html).toContain("rounded-lg shadow-none");
  });
});
