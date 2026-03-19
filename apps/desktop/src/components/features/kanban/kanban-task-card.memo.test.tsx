import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const workflowActionGroupRenderMock = mock((_: unknown) => {});
const noop = (): void => {};

mock.module("@/components/features/kanban/task-workflow-action-group", () => ({
  TaskWorkflowActionGroup: (props: unknown): ReactElement | null => {
    workflowActionGroupRenderMock(props);
    return null;
  },
}));

describe("KanbanTaskCard memoization", () => {
  beforeEach(() => {
    workflowActionGroupRenderMock.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test("skips rerender when task reference changes but compared fields are equivalent", async () => {
    const { KanbanTaskCard } = await import("./kanban-task-card");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Memoized card",
      status: "in_progress",
      issueType: "feature",
      priority: 2,
      subtaskIds: ["TASK-1.1"],
      availableActions: ["open_builder", "human_request_changes"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const activeSessions = [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
      } as const,
    ];

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={["/kanban"]}>
          <KanbanTaskCard
            task={task}
            runState="running"
            taskActivityState="active"
            activeSessions={activeSessions}
            onOpenDetails={noop}
            onDelegate={noop}
            onPlan={noop}
            onBuild={noop}
          />
        </MemoryRouter>,
      );
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.update(
        <MemoryRouter initialEntries={["/kanban"]}>
          <KanbanTaskCard
            task={{ ...task }}
            runState="running"
            taskActivityState="active"
            activeSessions={activeSessions.map((session) => ({ ...session }))}
            onOpenDetails={noop}
            onDelegate={noop}
            onPlan={noop}
            onBuild={noop}
          />
        </MemoryRouter>,
      );
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("rerenders when task workflow data changes", async () => {
    const { KanbanTaskCard } = await import("./kanban-task-card");

    const task = createTaskCardFixture({
      id: "TASK-2",
      status: "in_progress",
      availableActions: ["open_builder"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={["/kanban"]}>
          <KanbanTaskCard
            task={task}
            runState="running"
            taskActivityState="idle"
            activeSessions={[]}
            onOpenDetails={noop}
            onDelegate={noop}
            onPlan={noop}
            onBuild={noop}
          />
        </MemoryRouter>,
      );
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.update(
        <MemoryRouter initialEntries={["/kanban"]}>
          <KanbanTaskCard
            task={{
              ...task,
              availableActions: ["open_builder", "human_request_changes"],
              updatedAt: "2026-01-01T00:00:01.000Z",
            }}
            runState="running"
            taskActivityState="idle"
            activeSessions={[]}
            onOpenDetails={noop}
            onDelegate={noop}
            onPlan={noop}
            onBuild={noop}
          />
        </MemoryRouter>,
      );
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("rerenders when waiting-input state changes without a session status change", async () => {
    const { KanbanTaskCard } = await import("./kanban-task-card");

    const task = createTaskCardFixture({
      id: "TASK-3",
      status: "in_progress",
      availableActions: ["open_builder"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={["/kanban"]}>
          <KanbanTaskCard
            task={task}
            runState="running"
            taskActivityState="active"
            activeSessions={[
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
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.update(
        <MemoryRouter initialEntries={["/kanban"]}>
          <KanbanTaskCard
            task={task}
            runState="running"
            taskActivityState="waiting_input"
            activeSessions={[
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
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
    });
  });
});
