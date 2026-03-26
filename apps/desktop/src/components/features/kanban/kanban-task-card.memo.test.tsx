import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { KanbanTaskCard } from "./kanban-task-card";

enableReactActEnvironment();

const noop = (): void => {};

describe("KanbanTaskCard rerender behavior", () => {
  test("keeps markup stable when equivalent cloned props are provided", () => {
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Memoized card",
      status: "in_progress",
      availableActions: ["open_builder"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const taskSessions = [
      {
        runtimeKind: "opencode" as const,
        sessionId: "session-1",
        role: "build" as const,
        scenario: "build_implementation_start" as const,
        status: "running" as const,
        presentationState: "active" as const,
      },
    ];

    const { rerender, container, unmount } = render(
      <MemoryRouter initialEntries={["/kanban"]}>
        <KanbanTaskCard
          task={task}
          taskActivityState="active"
          taskSessions={taskSessions}
          onOpenDetails={noop}
          onDelegate={noop}
          onPlan={noop}
          onBuild={noop}
        />
      </MemoryRouter>,
    );

    const initialHtml = container.innerHTML;

    rerender(
      <MemoryRouter initialEntries={["/kanban"]}>
        <KanbanTaskCard
          task={{ ...task }}
          taskActivityState="active"
          taskSessions={taskSessions.map((session) => ({ ...session }))}
          onOpenDetails={noop}
          onDelegate={noop}
          onPlan={noop}
          onBuild={noop}
        />
      </MemoryRouter>,
    );

    expect(container.innerHTML).toBe(initialHtml);
    unmount();
  });

  test("updates rendered actions when task workflow actions change", () => {
    const baseTask = createTaskCardFixture({
      id: "TASK-2",
      title: "Workflow card",
      status: "in_progress",
      availableActions: ["open_builder"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { rerender, container, unmount } = render(
      <MemoryRouter initialEntries={["/kanban"]}>
        <KanbanTaskCard
          task={baseTask}
          taskActivityState="idle"
          taskSessions={[]}
          onOpenDetails={noop}
          onDelegate={noop}
          onPlan={noop}
          onBuild={noop}
        />
      </MemoryRouter>,
    );

    expect(container.innerHTML).toContain("Open Builder");

    rerender(
      <MemoryRouter initialEntries={["/kanban"]}>
        <KanbanTaskCard
          task={{
            ...baseTask,
            availableActions: ["human_request_changes"],
            updatedAt: "2026-01-01T00:00:01.000Z",
          }}
          taskActivityState="idle"
          taskSessions={[]}
          onOpenDetails={noop}
          onDelegate={noop}
          onPlan={noop}
          onBuild={noop}
          onHumanRequestChanges={noop}
        />
      </MemoryRouter>,
    );

    expect(container.innerHTML).toContain("Request Changes");
    unmount();
  });

  test("updates waiting-input visual state when activity changes", () => {
    const task = createTaskCardFixture({
      id: "TASK-3",
      status: "in_progress",
      availableActions: ["open_builder"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { rerender, container, unmount } = render(
      <MemoryRouter initialEntries={["/kanban"]}>
        <KanbanTaskCard
          task={task}
          taskActivityState="active"
          taskSessions={[
            {
              runtimeKind: "opencode",
              sessionId: "session-1",
              role: "build",
              scenario: "build_implementation_start",
              status: "running",
              presentationState: "active",
            },
          ]}
          onOpenDetails={noop}
          onDelegate={noop}
          onPlan={noop}
          onBuild={noop}
        />
      </MemoryRouter>,
    );

    expect(container.innerHTML).toContain("kanban-active-session-card");

    rerender(
      <MemoryRouter initialEntries={["/kanban"]}>
        <KanbanTaskCard
          task={task}
          taskActivityState="waiting_input"
          taskSessions={[
            {
              runtimeKind: "opencode",
              sessionId: "session-1",
              role: "build",
              scenario: "build_implementation_start",
              status: "running",
              presentationState: "waiting_input",
            },
          ]}
          onOpenDetails={noop}
          onDelegate={noop}
          onPlan={noop}
          onBuild={noop}
        />
      </MemoryRouter>,
    );

    expect(container.innerHTML).toContain("kanban-waiting-input-card");
    expect(container.innerHTML).not.toContain("kanban-active-session-ray");
    unmount();
  });
});
